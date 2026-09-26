// Where the notes live, from the iPhone: Documents › Parker in iCloud Drive,
// the same folder the Mac looks for — found, still arriving, or to create.

import Foundation
import Testing
@testable import ParkerCore

@Suite("where the notes live")
struct NotesHomeTests {
    @Test("the Dev build has a folder of its own")
    func devFolder() {
        #expect(NotesHome.folderName(dev: false) == "Parker")
        #expect(NotesHome.folderName(dev: true) == "Parker (Dev)")
    }

    @Test("the iCloud Drive root sits next to the app's container")
    func driveRoot() {
        let base = "/private/var/mobile/Library/Mobile Documents"
        let expected = "\(base)/com~apple~CloudDocs"
        for container in ["\(base)/iCloud~dev~getparker~parker/Documents", "\(base)/iCloud~dev~getparker~parker"] {
            #expect(NotesHome.iCloudDriveRoot(fromContainer: URL(fileURLWithPath: container)).path == expected)
        }
    }

    @Test("the folder is Documents › Parker under the root")
    func defaultFolder() {
        let root = URL(fileURLWithPath: "/x/com~apple~CloudDocs")
        #expect(NotesHome.defaultFolder(in: root, dev: false).path == "/x/com~apple~CloudDocs/Documents/Parker")
        #expect(NotesHome.defaultFolder(in: root, dev: true).path == "/x/com~apple~CloudDocs/Documents/Parker (Dev)")
    }

    @Test("found, arriving, or to create — and never Parker 2")
    func locate() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("notes-home-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        let docs = root.appendingPathComponent("Documents")
        try fm.createDirectory(at: docs, withIntermediateDirectories: true)
        let folder = NotesHome.defaultFolder(in: root, dev: false)

        #expect(NotesHome.locate(in: root, dev: false) == .create(folder))
        // iCloud has it, but not on this phone yet: a placeholder, and no creating.
        try Data().write(to: docs.appendingPathComponent(".Parker.icloud"))
        #expect(NotesHome.locate(in: root, dev: false) == .arriving(folder))
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        #expect(NotesHome.locate(in: root, dev: false) == .found(folder))
        // The Dev build never sees the real folder.
        #expect(NotesHome.locate(in: root, dev: true) == .create(NotesHome.defaultFolder(in: root, dev: true)))
    }
}
