// Where Parker's notes live by default, seen from the iPhone (Onda 5).
//
// Documents-first (decided 24/09): the one folder Parker looks for is
// Documents › Parker in iCloud Drive — the same folder a Mac with Desktop &
// Documents in iCloud has at ~/Documents/Parker, and the one the Mac also
// looks for in iCloud Drive when Documents stays on it. So whichever device
// comes first, the other finds the folder by itself. Development builds use
// "Parker (Dev)", as the Mac's Dev build does, and never touch the real one.
//
// "Continue with iCloud Drive" opens the Files picker at the iCloud Drive
// root; one tap on Open gives access to it, and this decides what to do there.

import Foundation

public enum NotesHome {
    /// The folder's name: "Parker", or "Parker (Dev)" for a development build.
    public static func folderName(dev: Bool) -> String { dev ? "Parker (Dev)" : "Parker" }

    /// The iCloud Drive root, from the app's own ubiquity container:
    /// …/Mobile Documents/iCloud~dev~getparker~parker → …/Mobile Documents/com~apple~CloudDocs.
    public static func iCloudDriveRoot(fromContainer container: URL) -> URL {
        var mobileDocuments = container.standardizedFileURL
        // The container URL may or may not end in "Documents".
        if mobileDocuments.lastPathComponent == "Documents" { mobileDocuments.deleteLastPathComponent() }
        mobileDocuments.deleteLastPathComponent()
        return mobileDocuments.appendingPathComponent("com~apple~CloudDocs", isDirectory: true)
    }

    /// Documents › Parker under an iCloud Drive root.
    public static func defaultFolder(in root: URL, dev: Bool) -> URL {
        root.appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent(folderName(dev: dev), isDirectory: true)
    }

    public enum Found: Equatable {
        /// There, with notes or not: use it.
        case found(URL)
        /// iCloud knows it but hasn't brought it to this phone yet: wait, don't
        /// create — a second folder would come back as "Parker 2".
        case arriving(URL)
        /// Not there: create it.
        case create(URL)
    }

    /// What to do at Documents › Parker under `root`. An item iCloud hasn't
    /// downloaded shows as a hidden ".<name>.icloud" placeholder next to where
    /// it will be.
    public static func locate(in root: URL, dev: Bool, fileManager fm: FileManager = .default) -> Found {
        let folder = defaultFolder(in: root, dev: dev)
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: folder.path, isDirectory: &isDir), isDir.boolValue { return .found(folder) }
        let placeholder = folder.deletingLastPathComponent().appendingPathComponent(".\(folder.lastPathComponent).icloud")
        if fm.fileExists(atPath: placeholder.path) { return .arriving(folder) }
        return .create(folder)
    }
}
