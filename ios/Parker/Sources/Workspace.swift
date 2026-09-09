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

    private static let bookmarkKey = "notesFolderBookmark"

    init() {
        restore()
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
        folderLabel = accessing ? url.lastPathComponent : (inICloud ? "iCloud Drive › Parker" : "On My iPhone › Parker")
        refresh()
        let w = FolderWatcher(folder: f, pollInterval: 3, queue: .main) { [weak self] _ in self?.refresh() }
        w.start()
        watcher = w
    }

    // ---- Reading and writing ---------------------------------------------------------

    func refresh() {
        guard let folder else { return }
        do { notes = try folder.list() } catch { lastError = error.localizedDescription }
    }

    func read(_ name: String) -> String {
        guard let folder else { return "" }
        return (try? folder.read(name)) ?? ""
    }

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
