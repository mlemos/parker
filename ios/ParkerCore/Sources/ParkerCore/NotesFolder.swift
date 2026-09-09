// The notes folder, exactly as the Mac treats it (src-tauri/src/lib.rs): a flat
// directory of plain files, addressed by bare filename. Dotfiles are the OS's
// business and `.parker-tmp` files are ours mid-write; everything else is a
// note. Writes are atomic — temp file beside the target, then rename — with the
// same temp naming, so a Mac watching the folder ignores our half-written files
// and we ignore its.

import Foundation

public struct NoteMeta: Equatable, Sendable {
    public let name: String
    public let modified: Date
}

public struct NoteHit: Equatable, Sendable {
    public let name: String
    public let modified: Date
    /// Matched by filename.
    public let inName: Bool
    /// First matching content line, trimmed, at most 140 characters.
    public let snippet: String?
}

public enum NotesFolderError: Error, Equatable, Sendable {
    case invalidName(String)
    case alreadyExists(String)
    case noFreeName
}

public struct NotesFolder: Sendable {
    public let url: URL
    /// Wrap reads and writes in NSFileCoordinator — what a folder that a File
    /// Provider (iCloud Drive, Google Drive, Dropbox) syncs asks for. Off for
    /// plain local folders and tests.
    public let coordinated: Bool

    public init(url: URL, coordinated: Bool = false) {
        self.url = url
        self.coordinated = coordinated
    }

    // ---- Names --------------------------------------------------------------

    /// validate_note_name: a plain filename living directly in the folder. A
    /// separator, a "..", or a leading dot is not a note — it is an attempt to
    /// reach out of the folder, or to write a file the app then refuses to list.
    public static func isValidName(_ name: String) -> Bool {
        !(name.isEmpty || name.contains("/") || name.contains("\\") || name.contains("..") || name.hasPrefix("."))
    }

    /// is_listed_note: whether a file in the folder is a note the app shows.
    public static func isListedNote(_ name: String) -> Bool {
        !name.hasPrefix(".") && !name.hasSuffix(".parker-tmp")
    }

    /// note_ext: alphanumerics only, "md" when nothing usable is left.
    public static func noteExt(_ ext: String?) -> String {
        let clean = (ext ?? "").unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }
        return clean.isEmpty ? "md" : String(String.UnicodeScalarView(clean))
    }

    public static let tempSuffix = ".parker-tmp"

    func path(_ name: String) throws -> URL {
        guard Self.isValidName(name) else { throw NotesFolderError.invalidName(name) }
        return url.appendingPathComponent(name, isDirectory: false)
    }

    // ---- Listing ------------------------------------------------------------

    /// Every note, newest first.
    public func list() throws -> [NoteMeta] {
        try entries().sorted { $0.modified > $1.modified }
    }

    private func entries() throws -> [NoteMeta] {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .contentModificationDateKey]
        let items = try FileManager.default.contentsOfDirectory(
            at: url, includingPropertiesForKeys: Array(keys), options: []
        )
        var out: [NoteMeta] = []
        for item in items {
            let name = item.lastPathComponent
            guard Self.isListedNote(name) else { continue }
            let values = try item.resourceValues(forKeys: keys)
            guard values.isRegularFile == true else { continue }
            out.append(NoteMeta(name: name, modified: values.contentModificationDate ?? Date(timeIntervalSince1970: 0)))
        }
        return out
    }

    // ---- Fetching from the cloud -------------------------------------------

    /// Is the note's content here on this device? A folder that a cloud
    /// provider syncs can list a note long before its bytes arrive; reading
    /// such a note blocks until they do.
    public func isLocal(_ name: String) -> Bool {
        guard let target = try? path(name),
              let values = try? target.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
              let status = values.ubiquitousItemDownloadingStatus else { return true }
        return status == .current
    }

    /// Ask the cloud for every note whose bytes are not here yet, so the
    /// folder is readable at once and the search never waits on a download.
    /// Notes are small; a whole scratchpad is a few megabytes. Returns how
    /// many were requested.
    @discardableResult
    public func fetchAll() -> Int {
        guard let items = try? FileManager.default.contentsOfDirectory(
            at: url, includingPropertiesForKeys: [.ubiquitousItemDownloadingStatusKey], options: []
        ) else { return 0 }
        var requested = 0
        for item in items where Self.isListedNote(item.lastPathComponent) {
            guard let status = (try? item.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?.ubiquitousItemDownloadingStatus,
                  status != .current else { continue }
            if (try? FileManager.default.startDownloadingUbiquitousItem(at: item)) != nil { requested += 1 }
        }
        return requested
    }

    // ---- Reading and writing ------------------------------------------------

    public func read(_ name: String) throws -> String {
        let target = try path(name)
        return try coordinateReading(target) { url in
            try String(contentsOf: url, encoding: .utf8)
        }
    }

    /// atomic_write: the whole text to `<name>.parker-tmp` beside the target,
    /// then rename over it, so a reader never sees a half-written note.
    public func write(_ name: String, _ text: String) throws {
        let target = try path(name)
        try coordinateWriting(target) { url in
            try Self.atomicWrite(text, to: url)
        }
    }

    static func atomicWrite(_ text: String, to target: URL) throws {
        let tmp = target.deletingLastPathComponent()
            .appendingPathComponent(target.lastPathComponent + tempSuffix, isDirectory: false)
        try Data(text.utf8).write(to: tmp, options: [])
        // rename(2): atomic, and replaces an existing target — the same call the
        // Mac makes. FileManager has no single primitive that does both.
        guard Darwin.rename(tmp.path, target.path) == 0 else {
            let err = errno
            try? FileManager.default.removeItem(at: tmp)
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(err))
        }
    }

    /// create_note: a new empty "Untitled-N.<ext>", N being the first integer
    /// that doesn't collide. Returns the name.
    public func create(ext: String? = nil) throws -> String {
        let ext = Self.noteExt(ext)
        for n in 1..<100_000 {
            let name = "Untitled-\(n).\(ext)"
            let target = try path(name)
            if !FileManager.default.fileExists(atPath: target.path) {
                try write(name, "")
                return name
            }
        }
        throw NotesFolderError.noFreeName
    }

    public func rename(_ from: String, to: String) throws {
        let src = try path(from)
        let dst = try path(to)
        if FileManager.default.fileExists(atPath: dst.path) { throw NotesFolderError.alreadyExists(to) }
        try FileManager.default.moveItem(at: src, to: dst)
    }

    /// Move a note to the Trash (recoverable), never a hard unlink. A note that
    /// is already gone counts as success.
    public func trash(_ name: String) throws {
        let target = try path(name)
        guard FileManager.default.fileExists(atPath: target.path) else { return }
        try coordinateWriting(target) { url in
            try FileManager.default.trashItem(at: url, resultingItemURL: nil)
        }
    }

    // ---- Search ----------------------------------------------------------------

    /// search_notes: by filename AND content. An empty query returns every
    /// note. Filename matches rank first, then newest first; a content match
    /// carries the first matching line as its snippet.
    public func search(_ query: String) throws -> [NoteHit] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var hits: [NoteHit] = []
        for note in try entries() {
            if q.isEmpty {
                hits.append(NoteHit(name: note.name, modified: note.modified, inName: true, snippet: nil))
                continue
            }
            let inName = note.name.lowercased().contains(q)
            let snippet: String? = (try? read(note.name)).flatMap { content in
                content.split(separator: "\n", omittingEmptySubsequences: false)
                    .first { $0.lowercased().contains(q) }
                    .map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(140)) }
            }
            if inName || snippet != nil {
                hits.append(NoteHit(name: note.name, modified: note.modified, inName: inName, snippet: snippet))
            }
        }
        return hits.sorted { a, b in
            if a.inName != b.inName { return a.inName }
            return a.modified > b.modified
        }
    }

    // ---- Coordination --------------------------------------------------------------

    private func coordinateReading<T>(_ target: URL, _ body: (URL) throws -> T) throws -> T {
        guard coordinated else { return try body(target) }
        var coordErr: NSError?
        var result: Result<T, Error>?
        NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &coordErr) { url in
            result = Result { try body(url) }
        }
        if let coordErr { throw coordErr }
        return try result!.get()
    }

    private func coordinateWriting(_ target: URL, _ body: (URL) throws -> Void) throws {
        guard coordinated else { return try body(target) }
        var coordErr: NSError?
        var bodyErr: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordErr) { url in
            do { try body(url) } catch { bodyErr = error }
        }
        if let coordErr { throw coordErr }
        if let bodyErr { throw bodyErr }
    }
}
