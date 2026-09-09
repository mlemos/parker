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
        for ok in ["a.md", "Untitled-1.md", "notes.txt", "x"] { #expect(NotesFolder.isValidName(ok), Comment(rawValue: ok)) }
        for bad in ["", "a/b.md", "a\\b.md", "..", "../x.md", ".hidden.md"] { #expect(!NotesFolder.isValidName(bad), Comment(rawValue: bad)) }
    }

    @Test("dotfiles and our own temp files are not listed")
    func listed() {
        #expect(NotesFolder.isListedNote("note.md"))
        #expect(NotesFolder.isListedNote("Untitled-1.txt"))
        #expect(!NotesFolder.isListedNote(".DS_Store"))
        #expect(!NotesFolder.isListedNote("note.md.parker-tmp"))
        #expect(!NotesFolder.isListedNote("note.parker-tmp"))
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
