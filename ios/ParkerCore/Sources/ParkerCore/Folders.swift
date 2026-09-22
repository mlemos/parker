// The folder side of the notes list and the search, as pure functions over
// names — the same rules as the Mac's picker (src/lib/picker.ts). A scope is
// "" for the root or a folder path with its trailing slash ("cos/desks/");
// a folder from the walk has none ("cos/desks"); a note is a relative name
// ("cos/desks/a.md").

import Foundation

public struct FolderRow: Equatable, Sendable, Hashable {
    /// With the trailing slash: "cos/desks/".
    public let path: String
    /// Notes inside, at any depth.
    public let count: Int
    /// The newest note inside; nil when empty.
    public let modified: Date?

    /// "cos/desks/" → "desks".
    public var name: String { Folders.name(of: path) }
}

public enum Folders {
    /// "cos/desks/" → "desks"; "" → "".
    public static func name(of scope: String) -> String {
        let bare = scope.hasSuffix("/") ? String(scope.dropLast()) : scope
        return bare.split(separator: "/").last.map(String.init) ?? bare
    }

    /// The scope one level up: "cos/desks/" → "cos/", "cos/" → "".
    public static func parent(of scope: String) -> String {
        let bare = scope.hasSuffix("/") ? String(scope.dropLast()) : scope
        guard let i = bare.lastIndex(of: "/") else { return "" }
        return String(bare[...i])
    }

    /// Every folder — the walked ones, plus any a note's name implies — as
    /// paths with the trailing slash.
    static func all(_ folders: [String], _ notes: [NoteMeta]) -> Set<String> {
        var out = Set<String>()
        for f in folders where !f.isEmpty { out.insert(f.hasSuffix("/") ? f : f + "/") }
        for n in notes {
            let parts = n.name.split(separator: "/")
            for d in 1..<max(parts.count, 1) { out.insert(parts[0..<d].joined(separator: "/") + "/") }
        }
        return out
    }

    static func row(_ path: String, _ notes: [NoteMeta]) -> FolderRow {
        var count = 0
        var newest: Date?
        for n in notes where n.name.hasPrefix(path) {
            count += 1
            if newest == nil || n.modified > newest! { newest = n.modified }
        }
        return FolderRow(path: path, count: count, modified: newest)
    }

    /// The folders directly under `scope`, alphabetically.
    public static func children(folders: [String], notes: [NoteMeta], scope: String) -> [FolderRow] {
        all(folders, notes)
            .filter { $0.hasPrefix(scope) && $0 != scope && !$0.dropFirst(scope.count).dropLast().contains("/") }
            .sorted()
            .map { row($0, notes) }
    }

    /// The folders below `scope`, at any depth, whose own name contains the
    /// query — "des" finds desks/ and cos/desks/ alike.
    public static func matching(folders: [String], notes: [NoteMeta], scope: String, query: String) -> [FolderRow] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return [] }
        return all(folders, notes)
            .filter { $0.hasPrefix(scope) && $0 != scope && name(of: $0).lowercased().contains(q) }
            .sorted()
            .map { row($0, notes) }
    }

    /// The notes that sit directly in `scope` — not in a folder below it.
    public static func own(notes: [NoteMeta], scope: String) -> [NoteMeta] {
        notes.filter { $0.name.hasPrefix(scope) && !$0.name.dropFirst(scope.count).contains("/") }
    }

    /// Every note under `scope`, at any depth.
    public static func under(notes: [NoteMeta], scope: String) -> [NoteMeta] {
        notes.filter { $0.name.hasPrefix(scope) }
    }
}
