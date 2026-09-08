// Watching the notes folder, so the list, the search index and an open note
// follow what a Mac (or another device) changes underneath us.
//
// Three sources, one outcome: a kqueue DispatchSource on the directory (local
// adds, removes, renames — including our own atomic rename), an NSFilePresenter
// on the directory (what File Providers such as iCloud Drive announce through
// file coordination), and an optional poll for the providers that announce
// nothing. Every source only schedules a rescan; the rescan diffs a snapshot
// (name → modified) against the last one and reports the difference. Events
// are coalesced over 150 ms, the Mac watcher's own settle time.

import Foundation

public struct FolderSnapshot: Equatable, Sendable {
    /// name → modification date, for every listed note.
    public let entries: [String: Date]

    public init(entries: [String: Date]) { self.entries = entries }

    public static func take(_ folder: NotesFolder) throws -> FolderSnapshot {
        FolderSnapshot(entries: Dictionary(uniqueKeysWithValues: try folder.list().map { ($0.name, $0.modified) }))
    }

    public func changes(to new: FolderSnapshot) -> FolderChanges {
        let old = entries
        let added = new.entries.keys.filter { old[$0] == nil }
        let removed = old.keys.filter { new.entries[$0] == nil }
        let modified = new.entries.filter { name, date in old[name] != nil && old[name] != date }.map(\.key)
        return FolderChanges(added: added.sorted(), removed: removed.sorted(), modified: modified.sorted())
    }
}

public struct FolderChanges: Equatable, Sendable {
    public let added: [String]
    public let removed: [String]
    public let modified: [String]
    public var isEmpty: Bool { added.isEmpty && removed.isEmpty && modified.isEmpty }
    public static let none = FolderChanges(added: [], removed: [], modified: [])
}

public final class FolderWatcher {
    public let folder: NotesFolder
    private let onChange: (FolderChanges) -> Void
    private let queue: DispatchQueue
    private let pollInterval: TimeInterval?
    private let settle: TimeInterval

    private var last: FolderSnapshot
    private var dirFD: Int32 = -1
    private var dirSource: DispatchSourceFileSystemObject?
    private var presenter: DirectoryPresenter?
    private var pollTimer: DispatchSourceTimer?
    private var pending: DispatchWorkItem?

    /// `onChange` runs on `queue`. `pollInterval` nil turns polling off.
    public init(
        folder: NotesFolder,
        pollInterval: TimeInterval? = 2,
        settle: TimeInterval = 0.15,
        queue: DispatchQueue = .main,
        onChange: @escaping (FolderChanges) -> Void
    ) {
        self.folder = folder
        self.pollInterval = pollInterval
        self.settle = settle
        self.queue = queue
        self.onChange = onChange
        self.last = (try? FolderSnapshot.take(folder)) ?? FolderSnapshot(entries: [:])
    }

    deinit { stop() }

    public func start() {
        stop()
        last = (try? FolderSnapshot.take(folder)) ?? last

        // 1. The directory itself, through the kernel.
        dirFD = open(folder.url.path, O_EVTONLY)
        if dirFD >= 0 {
            let src = DispatchSource.makeFileSystemObjectSource(
                fileDescriptor: dirFD, eventMask: [.write, .rename, .delete, .attrib, .extend], queue: queue
            )
            src.setEventHandler { [weak self] in self?.scheduleRescan() }
            src.setCancelHandler { [fd = dirFD] in close(fd) }
            src.resume()
            dirSource = src
        }

        // 2. Coordinated changes announced by a File Provider.
        let p = DirectoryPresenter(url: folder.url) { [weak self] in self?.scheduleRescan() }
        NSFileCoordinator.addFilePresenter(p)
        presenter = p

        // 3. Whatever announces nothing.
        if let interval = pollInterval {
            let t = DispatchSource.makeTimerSource(queue: queue)
            t.schedule(deadline: .now() + interval, repeating: interval)
            t.setEventHandler { [weak self] in self?.rescan() }
            t.resume()
            pollTimer = t
        }
    }

    public func stop() {
        dirSource?.cancel(); dirSource = nil; dirFD = -1   // the cancel handler closes the fd
        if let p = presenter { NSFileCoordinator.removeFilePresenter(p); presenter = nil }
        pollTimer?.cancel(); pollTimer = nil
        pending?.cancel(); pending = nil
    }

    /// Coalesce a burst (our own write is a create of the temp file, a write,
    /// and a rename) into one rescan after things settle.
    private func scheduleRescan() {
        pending?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.rescan() }
        pending = item
        queue.asyncAfter(deadline: .now() + settle, execute: item)
    }

    /// Look, diff, report. Public so a caller can force one (on foregrounding).
    public func rescan() {
        guard let now = try? FolderSnapshot.take(folder) else { return }
        let diff = last.changes(to: now)
        last = now
        if !diff.isEmpty { onChange(diff) }
    }
}

/// An NSFilePresenter for the directory: File Providers deliver their changes
/// through file coordination, and a presenter on the folder hears every
/// sub-item they touch.
final class DirectoryPresenter: NSObject, NSFilePresenter {
    let presentedItemURL: URL?
    let presentedItemOperationQueue = OperationQueue()
    private let fire: () -> Void

    init(url: URL, fire: @escaping () -> Void) {
        self.presentedItemURL = url
        self.fire = fire
        presentedItemOperationQueue.maxConcurrentOperationCount = 1
    }

    func presentedItemDidChange() { fire() }
    func presentedSubitemDidChange(at url: URL) { fire() }
    func presentedSubitemDidAppear(at url: URL) { fire() }
    func presentedSubitem(at oldURL: URL, didMoveTo newURL: URL) { fire() }
    func accommodatePresentedSubitemDeletion(at url: URL, completionHandler: @escaping (Error?) -> Void) {
        fire(); completionHandler(nil)
    }
}
