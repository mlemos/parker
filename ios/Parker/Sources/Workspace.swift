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
    private(set) var folderLabel = ""
    private(set) var lastError: String?
    private var watcher: FolderWatcher?
    private var accessing = false

    /// Files from outside the folder, open in place. Kept across launches by
    /// bookmark; the list is the "Files" section of Notes.
    private(set) var externals: [ExternalFile] = []
    /// Something the OS asked Parker to open (a tap in Files); the Notes tab
    /// takes it and clears it.
    var openRequest: NoteRef?

    private static let bookmarkKey = "notesFolderBookmark"
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

    /// "I already have notes": the folder the user picked in Files.
    func choose(_ url: URL) {
        guard url.startAccessingSecurityScopedResource() else {
            lastError = "Couldn't open that folder."
            return
        }
        do {
            let bookmark = try url.bookmarkData()
            UserDefaults.standard.set(bookmark, forKey: Self.bookmarkKey)
        } catch {
            lastError = "Couldn't keep access to that folder: \(error.localizedDescription)"
        }
        open(url, accessing: true)
    }

    /// "Start fresh": a folder of our own, born with one note that teaches by
    /// tapping. In iCloud Drive › Parker when iCloud is on — every Mac with the
    /// same account sees it — and in Files under On My iPhone › Parker when it
    /// is not, with a word about it.
    func startFresh() {
        busy = true
        Task.detached(priority: .userInitiated) {
            // Resolving the ubiquity container can block; never on the main thread.
            let ubiquity = FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents", isDirectory: true)
            await MainActor.run { self.finishStartFresh(ubiquity: ubiquity) }
        }
    }

    private(set) var busy = false
    private(set) var inICloud = false

    private func finishStartFresh(ubiquity: URL?) {
        busy = false
        let local = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let target = ubiquity ?? local
        do {
            try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
            let f = NotesFolder(url: target, coordinated: true)
            if try f.list().isEmpty {
                try f.write("Welcome to Parker.md", Self.welcomeNote)
            }
            UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
            UserDefaults.standard.set(ubiquity != nil ? "icloud" : "local", forKey: "ownFolder")
            inICloud = ubiquity != nil
            open(target, accessing: false)
        } catch {
            lastError = "Couldn't create the folder: \(error.localizedDescription)"
        }
    }

    func forget() {
        watcher?.stop(); watcher = nil
        if accessing { folder?.url.stopAccessingSecurityScopedResource(); accessing = false }
        folder = nil; notes = []
        UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
        UserDefaults.standard.removeObject(forKey: "ownFolder")
    }

    private func restore() {
        if let data = UserDefaults.standard.data(forKey: Self.bookmarkKey) {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale),
               url.startAccessingSecurityScopedResource() {
                open(url, accessing: true)
                return
            }
        }
        switch UserDefaults.standard.string(forKey: "ownFolder") {
        case "local":
            open(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0], accessing: false)
        case "icloud":
            busy = true
            Task.detached(priority: .userInitiated) {
                let url = FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents", isDirectory: true)
                await MainActor.run {
                    self.busy = false
                    if let url { self.inICloud = true; self.open(url, accessing: false) }
                    else { self.lastError = "iCloud Drive is off, so your Parker folder is out of reach on this phone." }
                }
            }
        default: break
        }
    }

    private func open(_ url: URL, accessing: Bool) {
        self.accessing = accessing
        let f = NotesFolder(url: url, coordinated: true)
        folder = f
        folderLabel = accessing ? Self.displayName(of: url) : (inICloud ? "iCloud Drive › Parker" : "On My iPhone › Parker")
        refresh()
        let w = FolderWatcher(folder: f, pollInterval: 3, queue: .main) { [weak self] _ in self?.refresh() }
        w.start()
        watcher = w
    }

    // ---- Reading and writing ---------------------------------------------------------

    func refresh() {
        guard let folder else { return }
        do { notes = try folder.list() } catch { lastError = error.localizedDescription }
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

    func create() -> String? {
        guard let folder else { return nil }
        do { let name = try folder.create(); refresh(); return name } catch { lastError = error.localizedDescription; return nil }
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
    It opens this same folder.

    """
}
