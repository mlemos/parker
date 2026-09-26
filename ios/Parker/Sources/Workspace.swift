// The app's one piece of state: which folder, what is in it, and the
// bookmark that lets us reach it again. Everything about files goes through
// ParkerCore's NotesFolder, so the rules are the Mac's.

import Foundation
import Observation
import ParkerCore

@MainActor @Observable
final class Workspace {
    private(set) var folder: NotesFolder?
    private(set) var notes: [NoteMeta] = []
    /// Every folder in the notes folder, any depth ("cos", "cos/desks") — the
    /// empty ones too, so a folder made in Files or on the Mac shows up.
    private(set) var folders: [String] = []
    private(set) var folderLabel = ""
    private(set) var lastError: String?
    private var watcher: FolderWatcher?
    private var accessing = false
    /// The URL whose security scope Parker holds: the picked folder, or — for
    /// Documents › Parker — the iCloud Drive root the grant was given for.
    private var scope: URL?

    /// Files from outside the folder, open in place. Kept across launches by
    /// bookmark; the list is the "Files" section of Notes.
    private(set) var externals: [ExternalFile] = []
    /// Something the OS asked Parker to open (a tap in Files); the Notes tab
    /// takes it and clears it.
    var openRequest: NoteRef?

    private static let bookmarkKey = "notesFolderBookmark"
    /// With a bookmark to the iCloud Drive root: the notes folder under it
    /// ("Documents/Parker").
    private static let subpathKey = "notesFolderSubpath"

    /// Development builds use Documents › Parker (Dev), as the Mac's Dev build
    /// does, and never touch the real notes.
    static var devBuild: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
    private static let externalsKey = "externalFiles"

    init() {
        restore()
        restoreExternals()
    }

    // ---- Naming a folder -----------------------------------------------------------

    /// The name Files shows for a folder. An iCloud container root is called
    /// "Parker Dev" on screen while its path ends in "Documents", so the last
    /// path component is the wrong thing to show or to judge.
    static func displayName(of url: URL) -> String {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        return (try? url.resourceValues(forKeys: [.localizedNameKey]).localizedName) ?? url.lastPathComponent
    }

    /// Debug builds only: does this folder look like it is meant for development?
    /// Our own dev container counts, whatever it is called on screen.
    static func looksLikeDevFolder(_ url: URL) -> Bool {
        url.path.contains("~parker~dev") || displayName(of: url).localizedCaseInsensitiveContains("dev")
    }

    // ---- Choosing a folder ---------------------------------------------------------

    /// "Use another folder": the folder the user picked in Files.
    func choose(_ url: URL) {
        guard url.startAccessingSecurityScopedResource() else {
            lastError = "Couldn't open that folder."
            return
        }
        do {
            let bookmark = try url.bookmarkData()
            UserDefaults.standard.set(bookmark, forKey: Self.bookmarkKey)
            UserDefaults.standard.removeObject(forKey: Self.subpathKey)
        } catch {
            lastError = "Couldn't keep access to that folder: \(error.localizedDescription)"
        }
        open(url, scope: url)
    }

    // ---- Continue with iCloud Drive (Onda 5) ----------------------------------------

    /// Whether iCloud Drive is on for this iPhone.
    var driveOn: Bool { FileManager.default.ubiquityIdentityToken != nil }

    /// The iCloud Drive root, where the Files picker opens for the grant. nil
    /// when iCloud Drive is off. Resolving the container can block: off the
    /// main thread.
    func driveRoot() async -> URL? {
        await Task.detached(priority: .userInitiated) {
            FileManager.default.url(forUbiquityContainerIdentifier: nil).map(NotesHome.iCloudDriveRoot(fromContainer:))
        }.value
    }

    /// The grant: the picker returned the iCloud Drive root. Keep access to it
    /// and say what is at Documents › Parker.
    func grant(root: URL) -> NotesHome.Found? {
        guard root.startAccessingSecurityScopedResource() else {
            lastError = "Couldn't open iCloud Drive."
            return nil
        }
        pendingRoot = root
        return NotesHome.locate(in: root, dev: Self.devBuild)
    }
    private(set) var pendingRoot: URL?

    /// What the screens say about a folder.
    func summary(of url: URL) -> FolderSummary { FolderSummary.of(url) }

    /// Continue on Documents › Parker in iCloud Drive: made if it isn't there,
    /// with a Welcome note when it has no notes, and remembered as the root's
    /// bookmark plus the path under it.
    func useDefault(_ folder: URL) {
        guard let root = pendingRoot else { return }
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try addWelcomeIfEmpty(folder)
            UserDefaults.standard.set(try root.bookmarkData(), forKey: Self.bookmarkKey)
            let sub = String(folder.standardizedFileURL.path.dropFirst(root.standardizedFileURL.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            UserDefaults.standard.set(sub, forKey: Self.subpathKey)
            UserDefaults.standard.removeObject(forKey: "ownFolder")
            pendingRoot = nil
            open(folder, scope: root)
        } catch {
            lastError = "Couldn't set up the folder: \(error.localizedDescription)"
        }
    }

    /// No iCloud Drive: On My iPhone › Parker, which the Mac can't reach —
    /// the screens say so.
    func startOnThisPhone() {
        let local = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        do {
            try addWelcomeIfEmpty(local)
            UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
            UserDefaults.standard.removeObject(forKey: Self.subpathKey)
            UserDefaults.standard.set("local", forKey: "ownFolder")
            inICloud = false
            open(local, scope: nil)
        } catch {
            lastError = "Couldn't create the folder: \(error.localizedDescription)"
        }
    }

    private func addWelcomeIfEmpty(_ url: URL) throws {
        let f = NotesFolder(url: url, coordinated: true)
        if try f.list().isEmpty { try f.write("Welcome to Parker.md", Self.welcomeNote) }
    }

    private(set) var busy = false
    private(set) var inICloud = false

    func forget() {
        watcher?.stop(); watcher = nil
        scope?.stopAccessingSecurityScopedResource(); scope = nil
        accessing = false
        folder = nil; notes = []
        UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
        UserDefaults.standard.removeObject(forKey: Self.subpathKey)
        UserDefaults.standard.removeObject(forKey: "ownFolder")
    }

    private func restore() {
        if let data = UserDefaults.standard.data(forKey: Self.bookmarkKey) {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale),
               url.startAccessingSecurityScopedResource() {
                // A bookmark to the iCloud Drive root carries the notes
                // folder's path under it.
                if let sub = UserDefaults.standard.string(forKey: Self.subpathKey), !sub.isEmpty {
                    open(url.appendingPathComponent(sub, isDirectory: true), scope: url)
                } else {
                    open(url, scope: url)
                }
                return
            }
        }
        switch UserDefaults.standard.string(forKey: "ownFolder") {
        case "local":
            open(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0], scope: nil)
        case "icloud":
            busy = true
            Task.detached(priority: .userInitiated) {
                let url = FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents", isDirectory: true)
                await MainActor.run {
                    self.busy = false
                    if let url { self.inICloud = true; self.open(url, scope: nil) }
                    else { self.lastError = "iCloud Drive is off, so your Parker folder is out of reach on this phone." }
                }
            }
        default: break
        }
    }

    private func open(_ url: URL, scope: URL?) {
        self.scope = scope
        accessing = scope != nil
        let f = NotesFolder(url: url, coordinated: true)
        folder = f
        let isDefault = scope != nil && scope != url
        folderLabel = isDefault ? "iCloud Drive › Documents › \(NotesHome.folderName(dev: Self.devBuild))"
            : accessing ? Self.displayName(of: url) : (inICloud ? "iCloud Drive › Parker" : "On My iPhone")
        refresh()
        let w = FolderWatcher(folder: f, pollInterval: 3, queue: .main) { [weak self] _ in self?.refresh() }
        w.start()
        watcher = w
    }

    // ---- Reading and writing ---------------------------------------------------------

    func refresh() {
        guard let folder else { return }
        do { notes = try folder.list() } catch { lastError = error.localizedDescription }
        folders = (try? folder.folders()) ?? []
        // A synced folder lists notes before their bytes arrive: ask for all
        // of them now, off the main thread, so opening one never waits.
        Task.detached(priority: .utility) { folder.fetchAll() }
    }

    func read(_ name: String) -> String {
        guard let folder else { return "" }
        return Perf.timed("read \(name)") { (try? folder.read(name)) ?? "" }
    }

    /// The note's text, read off the main thread: a note that is still in the
    /// cloud blocks its reader until it arrives, and the screen must not wait.
    func load(_ name: String) async -> String {
        guard let folder else { return "" }
        return await Task.detached(priority: .userInitiated) {
            Perf.timed("read \(name)") { (try? folder.read(name)) ?? "" }
        }.value
    }

    func isLocal(_ name: String) -> Bool { folder?.isLocal(name) ?? true }

    func write(_ name: String, _ text: String) {
        guard let folder else { return }
        do { try folder.write(name, text) } catch { lastError = error.localizedDescription }
    }

    /// A new note — inside `scope` ("cos/desks/") when one is given.
    func create(in scope: String = "") -> String? {
        guard let folder else { return nil }
        do { let name = try folder.create(in: scope.isEmpty ? nil : scope); refresh(); return name } catch { lastError = error.localizedDescription; return nil }
    }

    func search(_ query: String) -> [NoteHit] {
        guard let folder else { return [] }
        return (try? folder.search(query)) ?? []
    }

    /// Every to-do in every note, for the Tasks tab.
    func tasks() -> [TaskItem] {
        notes.flatMap { note in Todo.scan(note: note.name, TextDocument(read(note.name))) }
    }

    /// Rewrite one task's tag where it lives: a new state and priority, or no
    /// tag at all. The note is read again first — the list may be older than
    /// the file — and the line must still carry a tag, or nothing is written.
    func setTask(_ item: TaskItem, state: TodoState?, bangs: String) {
        let text = read(item.note)
        let doc = TextDocument(text)
        guard item.line >= 1, item.line <= doc.lineCount else { return }
        let line = doc.line(item.line)
        guard let tag = Todo.tag(of: line.text) else { return }
        let ns = text as NSString
        let out: String
        if let state {
            let from = line.from + tag.indent.utf16.count
            out = ns.replacingCharacters(in: NSRange(location: from, length: tag.length - tag.indent.utf16.count), with: "/" + state.rawValue + bangs)
        } else {
            let c = Todo.tagChange(line: line, tag: tag, next: nil)
            out = ns.replacingCharacters(in: NSRange(location: c.from, length: (c.to ?? c.from) - c.from), with: "")
        }
        write(item.note, out)
        refresh()
    }

    /// Where a task typed into the Tasks tab lands: a note of its own in the
    /// folder, created on first use, that the Mac sees like any other.
    static let inboxNote = "Inbox.md"

    /// A new open task at the end of the Inbox note. Returns the note's name.
    @discardableResult
    func addTask(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, folder != nil else { return nil }
        var body = (try? folder!.read(Self.inboxNote)) ?? "# Inbox\n"
        if !body.hasSuffix("\n") { body += "\n" }
        body += "/TODO " + trimmed + "\n"
        write(Self.inboxNote, body)
        refresh()
        return Self.inboxNote
    }

    // ---- Files from outside the folder -----------------------------------------------

    /// Open a file the OS or the picker handed over. One of ours — at any
    /// depth in the notes folder — opens as the note it is; anything else is
    /// admitted as an external file, its access kept by bookmark.
    @discardableResult
    func open(fileAt url: URL) -> NoteRef? {
        if let name = folder?.noteName(of: url) { return .note(name) }
        if let known = externals.first(where: { $0.url.path == url.path }) { return .external(known) }
        // The URL from Files is security-scoped: access must be claimed before
        // the bookmark can be made, and stays claimed while the file is open.
        let claimed = url.startAccessingSecurityScopedResource()
        guard let bookmark = try? url.bookmarkData() else {
            if claimed { url.stopAccessingSecurityScopedResource() }
            lastError = "Couldn\u{2019}t keep access to that file."
            return nil
        }
        let file = ExternalFile(url: url, bookmark: bookmark)
        externals.insert(file, at: 0)
        saveExternals()
        return .external(file)
    }

    /// Forget an external file: its bookmark goes, and so does our claim on it.
    func close(external file: ExternalFile) {
        externals.removeAll { $0.id == file.id }
        file.url.stopAccessingSecurityScopedResource()
        saveExternals()
    }

    private func saveExternals() {
        UserDefaults.standard.set(externals.map(\.bookmark), forKey: Self.externalsKey)
    }

    /// Resolve the kept bookmarks; one whose file is gone is dropped in silence.
    private func restoreExternals() {
        guard let list = UserDefaults.standard.array(forKey: Self.externalsKey) as? [Data] else { return }
        var out: [ExternalFile] = []
        var changed = false
        for data in list {
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale),
                  url.startAccessingSecurityScopedResource() else { changed = true; continue }
            guard FileManager.default.fileExists(atPath: url.path) else { url.stopAccessingSecurityScopedResource(); changed = true; continue }
            let bookmark = stale ? ((try? url.bookmarkData()) ?? data) : data
            if bookmark != data { changed = true }
            out.append(ExternalFile(url: url, bookmark: bookmark))
        }
        externals = out
        if changed { saveExternals() }
    }

    func read(external file: ExternalFile) -> String {
        var err: NSError?
        var text = ""
        NSFileCoordinator().coordinate(readingItemAt: file.url, options: [], error: &err) { url in
            text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        }
        if let err { lastError = err.localizedDescription }
        return text
    }

    func write(external file: ExternalFile, _ text: String) {
        var err: NSError?
        NSFileCoordinator().coordinate(writingItemAt: file.url, options: .forReplacing, error: &err) { url in
            do { try Data(text.utf8).write(to: url, options: .atomic) } catch { lastError = error.localizedDescription }
        }
        if let err { lastError = err.localizedDescription }
    }

    // ---- Any note, by reference ---------------------------------------------------------

    func load(_ ref: NoteRef) async -> String {
        switch ref {
        case .note(let name): return await load(name)
        case .external(let f): return await Task.detached(priority: .userInitiated) { [self] in await self.read(external: f) }.value
        }
    }

    func read(_ ref: NoteRef) -> String {
        switch ref {
        case .note(let name): return read(name)
        case .external(let f): return read(external: f)
        }
    }

    func write(_ ref: NoteRef, _ text: String) {
        switch ref {
        case .note(let name): write(name, text)
        case .external(let f): write(external: f, text)
        }
    }

    func isLocal(_ ref: NoteRef) -> Bool {
        if case .note(let name) = ref { return isLocal(name) }
        return true
    }

    static let welcomeNote = """
    # Welcome to Parker

    Notes are plain files in your folder.
    Nothing to sync, nothing to sign in to.

    Tasks are lines that start with a tag:

    /TODO Tap the box to move this along
    /DOING Tap again to keep it going
    /DONE That is the whole system

    Add a priority with bangs:

    /TODO! Low
    /TODO!! Medium
    /TODO!!! High

    Nested lines belong to the task above.
    /TODO Like this one
      - and this note under it

    Headings, **bold** and `code` work too.

    On a Mac? Get Parker at getparker.dev
    Its welcome screen finds this folder by itself
    when it is Documents › Parker in iCloud Drive.

    """
}
