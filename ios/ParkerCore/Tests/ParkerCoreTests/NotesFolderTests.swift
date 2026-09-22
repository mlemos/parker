// The folder model against a real temporary directory — the rules are the
// Mac's (src-tauri/src/lib.rs), so the two apps agree on what a note is, how
// it is written, and what a search returns.

import Foundation
import Testing
@testable import ParkerCore

private func makeTempFolder() throws -> NotesFolder {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("ParkerCoreTests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return NotesFolder(url: dir)
}

private func touch(_ folder: NotesFolder, _ name: String, _ text: String = "", modified: Date? = nil) throws {
    let url = folder.url.appendingPathComponent(name)
    try Data(text.utf8).write(to: url)
    if let modified {
        try FileManager.default.setAttributes([.modificationDate: modified], ofItemAtPath: url.path)
    }
}

@Suite("note names") struct NameTests {
    @Test("a note is a plain filename in the folder, nothing that reaches out of it")
    func validity() {
        for ok in ["a.md", "Untitled-1.md", "notes.txt", "x", "backlogs/parker.md", "a/b/c/deep.md", "a..b.md"] { #expect(NotesFolder.isValidName(ok), Comment(rawValue: ok)) }
        for bad in ["", "a\\b.md", "..", "../x.md", ".hidden.md", "/etc/passwd", "sub/../x.md", "sub/.hidden.md", ".git/config", "a//b.md", "sub/"] { #expect(!NotesFolder.isValidName(bad), Comment(rawValue: bad)) }
    }

    @Test("dotfiles and our own temp files are not listed")
    func listed() {
        #expect(NotesFolder.isListedNote("note.md"))
        #expect(NotesFolder.isListedNote("Untitled-1.txt"))
        #expect(!NotesFolder.isListedNote(".DS_Store"))
        #expect(!NotesFolder.isListedNote("note.md.parker-tmp"))
        #expect(!NotesFolder.isListedNote("note.parker-tmp"))
        #expect(NotesFolder.isListedNote("backlogs/parker.md"))
        #expect(!NotesFolder.isListedNote(".git/HEAD"))
        #expect(!NotesFolder.isListedNote("sub/.DS_Store"))
    }

    @Test("a name shows as its filename, and knows its folder")
    func display() {
        #expect(NotesFolder.displayName("backlogs/parker.md") == "parker.md")
        #expect(NotesFolder.displayName("top.md") == "top.md")
        #expect(NotesFolder.folderOf("backlogs/parker.md") == "backlogs/")
        #expect(NotesFolder.folderOf("a/b/c.md") == "a/b/")
        #expect(NotesFolder.folderOf("top.md") == "")
    }

    @Test("a new note's extension is alphanumerics only, md when nothing is left")
    func ext() {
        #expect(NotesFolder.noteExt(nil) == "md")
        #expect(NotesFolder.noteExt("") == "md")
        #expect(NotesFolder.noteExt("txt") == "txt")
        #expect(NotesFolder.noteExt(".t/x.t") == "txt")
        #expect(NotesFolder.noteExt("..") == "md")
    }
}

@Suite("listing and writing") struct FolderTests {
    @Test("lists notes at any depth, by relative name, skipping dot-folders and symlinked folders")
    func nested() throws {
        let f = try makeTempFolder()
        let fm = FileManager.default
        try fm.createDirectory(at: f.url.appendingPathComponent("backlogs/deeper"), withIntermediateDirectories: true)
        try fm.createDirectory(at: f.url.appendingPathComponent(".git/refs"), withIntermediateDirectories: true)
        try touch(f, "top.md", "a")
        try touch(f, "backlogs/parker.md", "b")
        try touch(f, "backlogs/deeper/x.txt", "c")
        try touch(f, "backlogs/note.md.parker-tmp", "d")
        try touch(f, ".git/HEAD", "e")
        let outside = fm.temporaryDirectory.appendingPathComponent("outside-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: outside, withIntermediateDirectories: true)
        try Data("secret".utf8).write(to: outside.appendingPathComponent("secret.md"))
        try fm.createSymbolicLink(at: f.url.appendingPathComponent("link"), withDestinationURL: outside)
        #expect(try f.list().map(\.name).sorted() == ["backlogs/deeper/x.txt", "backlogs/parker.md", "top.md"])
        #expect(try f.read("backlogs/parker.md") == "b")
        // writing into a folder that does not exist yet makes it
        try f.write("new/here.md", "z")
        #expect(try f.read("new/here.md") == "z")
        try? fm.removeItem(at: outside)
    }

    @Test("knows a file of its own by its relative name, at any depth, and nothing else")
    func noteNameOf() throws {
        let f = try makeTempFolder()
        try FileManager.default.createDirectory(at: f.url.appendingPathComponent("backlogs"), withIntermediateDirectories: true)
        try touch(f, "top.md"); try touch(f, "backlogs/parker.md")
        #expect(f.noteName(of: f.url.appendingPathComponent("top.md")) == "top.md")
        #expect(f.noteName(of: f.url.appendingPathComponent("backlogs/parker.md")) == "backlogs/parker.md")
        #expect(f.noteName(of: f.url.appendingPathComponent(".git/HEAD")) == nil)
        #expect(f.noteName(of: URL(fileURLWithPath: "/tmp/elsewhere.md")) == nil)
        // a sibling folder whose name merely starts with ours is not inside
        #expect(f.noteName(of: URL(fileURLWithPath: f.url.path + "-other/x.md")) == nil)
    }

    @Test("lists notes newest first, skipping dotfiles, temp files and folders")
    func listing() throws {
        let f = try makeTempFolder()
        let t0 = Date(timeIntervalSince1970: 1_700_000_000)
        try touch(f, "old.md", "a", modified: t0)
        try touch(f, "new.md", "b", modified: t0.addingTimeInterval(60))
        try touch(f, "mid.txt", "c", modified: t0.addingTimeInterval(30))
        try touch(f, ".DS_Store", "x")
        try touch(f, "half.md.parker-tmp", "y")
        try FileManager.default.createDirectory(at: f.url.appendingPathComponent("sub"), withIntermediateDirectories: true)
        #expect(try f.list().map(\.name) == ["new.md", "mid.txt", "old.md"])
    }

    @Test("writes atomically: the temp file is gone and the text is there, on create and on overwrite")
    func atomicWrite() throws {
        let f = try makeTempFolder()
        try f.write("a.md", "one")
        try f.write("a.md", "two")
        #expect(try f.read("a.md") == "two")
        let names = try FileManager.default.contentsOfDirectory(atPath: f.url.path)
        #expect(names == ["a.md"])
    }

    @Test("the same rules hold through NSFileCoordinator")
    func coordinated() throws {
        let f = NotesFolder(url: try makeTempFolder().url, coordinated: true)
        try f.write("c.md", "# hi")
        #expect(try f.read("c.md") == "# hi")
        try f.write("c.md", "# hi again")
        #expect(try f.read("c.md") == "# hi again")
    }

    @Test("refuses names that reach out of the folder")
    func refuses() throws {
        let f = try makeTempFolder()
        #expect(throws: NotesFolderError.invalidName("../x.md")) { try f.write("../x.md", "no") }
        #expect(throws: NotesFolderError.invalidName(".secret")) { try f.read(".secret") }
    }

    @Test("creates Untitled-N with the first free N, md by default")
    func create() throws {
        let f = try makeTempFolder()
        #expect(try f.create() == "Untitled-1.md")
        #expect(try f.create() == "Untitled-2.md")
        try touch(f, "Untitled-3.md")
        #expect(try f.create() == "Untitled-4.md")
        #expect(try f.create(ext: "txt") == "Untitled-1.txt")
        #expect(try f.read("Untitled-1.md") == "")
    }

    @Test("renames, but never over an existing note")
    func rename() throws {
        let f = try makeTempFolder()
        try f.write("a.md", "a")
        try f.write("b.md", "b")
        #expect(throws: NotesFolderError.alreadyExists("b.md")) { try f.rename("a.md", to: "b.md") }
        try f.rename("a.md", to: "c.md")
        #expect(try f.list().map(\.name).sorted() == ["b.md", "c.md"])
    }

    @Test("trashing a note that is already gone is fine")
    func trashMissing() throws {
        let f = try makeTempFolder()
        try f.trash("nothing.md")
    }
}

@Suite("search") struct SearchTests {
    @Test("an empty query returns every note, newest first")
    func empty() throws {
        let f = try makeTempFolder()
        let t0 = Date(timeIntervalSince1970: 1_700_000_000)
        try touch(f, "a.md", "x", modified: t0)
        try touch(f, "b.md", "y", modified: t0.addingTimeInterval(1))
        let hits = try f.search("  ")
        #expect(hits.map(\.name) == ["b.md", "a.md"])
        #expect(hits.allSatisfy { $0.inName && $0.snippet == nil })
    }

    @Test("filename matches rank first, content matches carry the first matching line, case-insensitively")
    func ranking() throws {
        let f = try makeTempFolder()
        let t0 = Date(timeIntervalSince1970: 1_700_000_000)
        try touch(f, "Launch checklist.md", "# Launch\n\nnothing here", modified: t0)
        try touch(f, "Weekly review.md", "notes\n  /DONE Move the LAUNCH date to the 14th  \nmore", modified: t0.addingTimeInterval(10))
        try touch(f, "Reading list.md", "no match", modified: t0.addingTimeInterval(20))
        let hits = try f.search("launch")
        #expect(hits.map(\.name) == ["Launch checklist.md", "Weekly review.md"])
        #expect(hits[0].inName && hits[0].snippet == "# Launch")
        #expect(!hits[1].inName && hits[1].snippet == "/DONE Move the LAUNCH date to the 14th")
    }

    @Test("snippets are cut at 140 characters")
    func snippetLength() throws {
        let f = try makeTempFolder()
        try touch(f, "long.md", String(repeating: "needle ", count: 40))
        #expect(try f.search("needle").first?.snippet?.count == 140)
    }
}

@Suite struct NotesFolderCloudTests {
    @Test func aLocalFolderIsAlreadyHere() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let folder = NotesFolder(url: dir)
        try folder.write("a.md", "hello")
        #expect(folder.isLocal("a.md"))
        #expect(folder.fetchAll() == 0)
    }
}

@Suite("folders in the list") struct FolderListTests {
    private func meta(_ name: String, _ t: TimeInterval) -> NoteMeta { NoteMeta(name: name, modified: Date(timeIntervalSince1970: t)) }
    private var notes: [NoteMeta] {
        [meta("inbox.md", 100), meta("cos/README.md", 50), meta("cos/charter.md", 80), meta("cos/desks/README.md", 30),
         meta("desks/parker.md", 90), meta("desks/itau.md", 20), meta("archive/changelog/2026-09.md", 10)]
    }
    // The walk knows a folder no note is in yet.
    private let walked = ["archive", "archive/changelog", "cos", "cos/desks", "desks", "empty"]

    @Test("names a scope and steps out of it")
    func scopes() {
        #expect(Folders.name(of: "cos/desks/") == "desks")
        #expect(Folders.name(of: "desks/") == "desks")
        #expect(Folders.parent(of: "cos/desks/") == "cos/")
        #expect(Folders.parent(of: "cos/") == "")
        #expect(Folders.parent(of: "") == "")
    }

    @Test("lists the folders directly under the root, alphabetically, with what they hold")
    func children() {
        let rows = Folders.children(folders: walked, notes: notes, scope: "")
        #expect(rows.map(\.path) == ["archive/", "cos/", "desks/", "empty/"])
        let cos = rows.first { $0.path == "cos/" }!
        #expect(cos.count == 3)
        #expect(cos.modified == Date(timeIntervalSince1970: 80))
        let empty = rows.first { $0.path == "empty/" }!
        #expect(empty.count == 0)
        #expect(empty.modified == nil)
    }

    @Test("lists only the next level inside a folder, and knows a folder from a note's name alone")
    func nested() {
        #expect(Folders.children(folders: walked, notes: notes, scope: "cos/").map(\.path) == ["cos/desks/"])
        #expect(Folders.children(folders: walked, notes: notes, scope: "cos/desks/").isEmpty)
        #expect(Folders.children(folders: [], notes: notes, scope: "").map(\.path) == ["archive/", "cos/", "desks/"])
    }

    @Test("finds folders at any depth by their own name, never the scope itself")
    func matching() {
        #expect(Folders.matching(folders: walked, notes: notes, scope: "", query: "des").map(\.path) == ["cos/desks/", "desks/"])
        #expect(Folders.matching(folders: walked, notes: notes, scope: "", query: "cos").map(\.path) == ["cos/"])
        #expect(Folders.matching(folders: walked, notes: notes, scope: "cos/", query: "cos").isEmpty)
        #expect(Folders.matching(folders: walked, notes: notes, scope: "", query: "").isEmpty)
    }

    @Test("tells a folder's own notes from everything under it")
    func ownAndUnder() {
        #expect(Folders.own(notes: notes, scope: "cos/").map(\.name) == ["cos/README.md", "cos/charter.md"])
        #expect(Folders.under(notes: notes, scope: "cos/").count == 3)
        #expect(Folders.own(notes: notes, scope: "").map(\.name) == ["inbox.md"])
    }

    @Test("walks folders at any depth, the empty ones included, skipping dot folders")
    func walk() throws {
        let f = try makeTempFolder()
        try FileManager.default.createDirectory(at: f.url.appendingPathComponent("cos/desks"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: f.url.appendingPathComponent("empty"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: f.url.appendingPathComponent(".git/objects"), withIntermediateDirectories: true)
        try touch(f, "cos/a.md")
        #expect(try f.folders() == ["cos", "cos/desks", "empty"])
    }

    @Test("creates a note inside a folder, making the folder on the way, and refuses one that reaches out")
    func createIn() throws {
        let f = try makeTempFolder()
        #expect(try f.create(in: "cos/desks") == "cos/desks/Untitled-1.md")
        #expect(try f.create(in: "cos/desks/") == "cos/desks/Untitled-2.md")
        #expect(try f.create(in: "") == "Untitled-1.md")
        #expect(try f.create() == "Untitled-2.md")
        #expect(throws: NotesFolderError.invalidName("../x")) { try f.create(in: "../x") }
        #expect(throws: NotesFolderError.invalidName(".git")) { try f.create(in: ".git") }
    }
}
