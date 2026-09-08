import Foundation
import Testing
@testable import ParkerCore

private func tempFolder() throws -> NotesFolder {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("ParkerCoreWatch-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return NotesFolder(url: dir)
}

@Suite("folder snapshot") struct SnapshotTests {
    @Test("reports what appeared, what left, and what changed underneath")
    func diff() {
        let t0 = Date(timeIntervalSince1970: 1_700_000_000)
        let old = FolderSnapshot(entries: ["a.md": t0, "b.md": t0, "c.md": t0])
        let new = FolderSnapshot(entries: ["a.md": t0, "b.md": t0.addingTimeInterval(5), "d.md": t0])
        #expect(old.changes(to: new) == FolderChanges(added: ["d.md"], removed: ["c.md"], modified: ["b.md"]))
        #expect(old.changes(to: old).isEmpty)
    }

    @Test("a snapshot sees only listed notes")
    func take() throws {
        let f = try tempFolder()
        try f.write("a.md", "x")
        try Data().write(to: f.url.appendingPathComponent(".hidden"))
        try Data().write(to: f.url.appendingPathComponent("b.md.parker-tmp"))
        #expect(Set(try FolderSnapshot.take(f).entries.keys) == ["a.md"])
    }
}

@Suite("folder watcher", .serialized) struct WatcherTests {
    @Test("hears a note being created next to it, once, after the burst settles")
    func local() async throws {
        let f = try tempFolder()
        let queue = DispatchQueue(label: "watch-test")
        await confirmation("one change, with the new note added", expectedCount: 1) { confirm in
            let w = FolderWatcher(folder: f, pollInterval: nil, queue: queue) { changes in
                if changes.added == ["a.md"] { confirm() }
            }
            w.start()
            try? f.write("a.md", "hello")            // temp file, write, rename — one report
            try? await Task.sleep(for: .milliseconds(900))
            w.stop()
        }
    }

    @Test("hears a coordinated change through the presenter as well as the kernel")
    func coordinated() async throws {
        let f = NotesFolder(url: try tempFolder().url, coordinated: true)
        try f.write("a.md", "v1")
        let queue = DispatchQueue(label: "watch-test-2")
        await confirmation("the modified note is reported", expectedCount: 1) { confirm in
            let w = FolderWatcher(folder: f, pollInterval: nil, queue: queue) { changes in
                if changes.modified == ["a.md"] { confirm() }
            }
            w.start()
            try? await Task.sleep(for: .milliseconds(50))
            try? f.write("a.md", "v2 — a longer body so the size and date both move")
            try? await Task.sleep(for: .milliseconds(900))
            w.stop()
        }
    }

    @Test("a forced rescan reports a removal, polling off")
    func rescan() throws {
        let f = try tempFolder()
        try f.write("gone.md", "x")
        var got: [FolderChanges] = []
        let w = FolderWatcher(folder: f, pollInterval: nil, queue: .main) { got.append($0) }
        try FileManager.default.removeItem(at: f.url.appendingPathComponent("gone.md"))
        w.rescan()
        #expect(got == [FolderChanges(added: [], removed: ["gone.md"], modified: [])])
        w.rescan()
        #expect(got.count == 1)
    }
}
