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

    /// "Start fresh": a folder of our own, visible in Files under On My iPhone ›
    /// Parker, born with one note that teaches by tapping.
    func startFresh() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        do {
            try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
            let f = NotesFolder(url: docs)
            if try f.list().isEmpty {
                try f.write("Welcome to Parker.md", Self.welcomeNote)
            }
            UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
            UserDefaults.standard.set(true, forKey: "usesOwnFolder")
            open(docs, accessing: false)
        } catch {
            lastError = "Couldn't create the folder: \(error.localizedDescription)"
        }
    }

    func forget() {
        watcher?.stop(); watcher = nil
        if accessing { folder?.url.stopAccessingSecurityScopedResource(); accessing = false }
        folder = nil; notes = []
        UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
        UserDefaults.standard.removeObject(forKey: "usesOwnFolder")
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
        if UserDefaults.standard.bool(forKey: "usesOwnFolder") {
            open(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0], accessing: false)
        }
    }

    private func open(_ url: URL, accessing: Bool) {
        self.accessing = accessing
        let f = NotesFolder(url: url, coordinated: true)
        folder = f
        folderLabel = accessing ? url.lastPathComponent : "On My iPhone › Parker"
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
