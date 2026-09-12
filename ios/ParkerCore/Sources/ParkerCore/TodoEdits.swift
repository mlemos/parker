// The edits the to-do gestures produce — ⌘⏎ / the accessory-bar button on a
// selection, and where the cursor belongs afterwards. Pure: they return
// changes, they do not apply them.

import Foundation

/// A replacement of [from, to) with `insert`; `to == nil` means a pure insert,
/// `insert == nil` a pure deletion. UTF-16 offsets.
public struct Change: Equatable, Sendable {
    public let from: Int
    public let to: Int?
    public let insert: String?

    public init(from: Int, to: Int? = nil, insert: String? = nil) {
        self.from = from
        self.to = to
        self.insert = insert
    }
}

extension Todo {
    /// Edit that rewrites a line's tag to `next` (nil removes it, plus the one
    /// space that separated it from the text). The priority bangs travel with
    /// the state: rotating `/TODO!!` gives `/DOING!!`.
    public static func tagChange(line: DocLine, tag: Tag, next: TodoState?) -> Change {
        let from = line.from + tag.indent.utf16.count
        let tagEnd = line.from + tag.length
        if let next { return Change(from: from, to: tagEnd, insert: "/" + next.rawValue + tag.bangs) }
        let u = Array(line.text.utf16)
        let hasSpace = tag.length < u.count && u[tag.length] == 0x20
        return Change(from: from, to: tagEnd + (hasSpace ? 1 : 0))
    }

    /// The edits ⌘⏎ should apply for a selection spanning [from, to].
    ///
    /// One rule covers both the single-line and multi-line cases: if any
    /// candidate line lacks a tag, tag those lines /TODO (leaving already-tagged
    /// lines alone); otherwise advance every line one step through the rotation.
    ///
    /// Line selection follows the editor convention that a selection ending at
    /// column 0 does not include that line — but only when it spans more than
    /// one line, so a cursor resting at the start of a line still acts on that
    /// line. Blank lines are skipped when several lines are selected; a lone
    /// cursor on a blank line still gets a tag (that's how you start a new to-do).
    public static func planRotate(_ doc: TextDocument, from: Int, to: Int) -> [Change] {
        let lines = linesInRange(doc, from: from, to: to)
        if lines.isEmpty { return [] }

        let untagged = lines.filter { $0.tag == nil }
        if !untagged.isEmpty {
            return untagged.map { entry in
                Change(from: entry.line.from + leadingWhitespaceUTF16(entry.line.text), insert: "/TODO ")
            }
        }
        return lines.map { entry in
            tagChange(line: entry.line, tag: entry.tag!, next: nextInRotation(entry.tag!.state))
        }
    }

    /// The lines a gesture over [from, to] acts on — the selection convention
    /// planRotate describes, shared by every gesture that works line by line.
    static func linesInRange(_ doc: TextDocument, from: Int, to: Int) -> [(line: DocLine, tag: Tag?)] {
        let startLine = doc.lineAt(from)
        let endLine: DocLine = {
            if to > from && to > startLine.to && doc.lineAt(to).from == to {
                return doc.lineAt(to - 1)
            }
            return doc.lineAt(to)
        }()

        let multi = endLine.number > startLine.number
        var lines: [(line: DocLine, tag: Tag?)] = []
        for n in startLine.number...endLine.number {
            let line = doc.line(n)
            if multi && isBlank(line.text) { continue }
            lines.append((line, tag(of: line.text)))
        }
        return lines
    }

    /// The highest priority a tag can carry: `/TODO!!!`.
    public static let maxPriority = 3

    /// The edits ⌃⌘↑ / ⌃⌘↓ should apply for a selection spanning [from, to]:
    /// every tagged line moves one step of priority in `delta`'s direction,
    /// clamped to 0…3. Lines without a tag are left alone — priority is a fact
    /// about a task, and there is no task to speak of.
    public static func planPriority(_ doc: TextDocument, from: Int, to: Int, delta: Int) -> [Change] {
        var changes: [Change] = []
        for entry in linesInRange(doc, from: from, to: to) {
            guard let tag = entry.tag else { continue }
            let next = min(maxPriority, max(0, tag.priority + delta))
            if next == tag.priority { continue }
            // Only the bangs move: from the end of the word to the end of the tag.
            let bangsAt = entry.line.from + tag.indent.utf16.count + 1 + tag.word.utf16.count
            changes.append(Change(from: bangsAt, to: entry.line.from + tag.length, insert: String(repeating: "!", count: next)))
        }
        return changes
    }

    /// Where the cursor belongs after `changes` are applied, or nil to let the
    /// editor map it as usual.
    ///
    /// Inserting a tag at the start of the cursor's own line is the case that
    /// needs help: the editor maps a position to *before* text inserted at it,
    /// which would leave the cursor in front of "/TODO " — so the next thing
    /// typed lands outside the tag. Park it after the tag (and its space).
    public static func cursorAfterRotate(_ changes: [Change], head: Int) -> Int? {
        guard changes.count == 1 else { return nil } // multi-line: keep the selection
        let c = changes[0]
        guard c.to == nil, let insert = c.insert else { return nil } // rewrote/removed a tag
        let inserted = insert.utf16.count
        let mapped = head >= c.from ? head + inserted : head
        return max(mapped, c.from + inserted)
    }

    // `\s*` at the start of the line — every whitespace, like the TS regex.
    public static func leadingWhitespaceUTF16(_ text: String) -> Int {
        var n = 0
        for scalar in text.unicodeScalars {
            if CharacterSet.whitespacesAndNewlines.contains(scalar) { n += String(scalar).utf16.count } else { break }
        }
        return n
    }

    static func isBlank(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// ---- Enter: a task or a list continues, an empty one ends ----------------------

extension Todo {
    /// What Enter should do on a line with the cursor at UTF-16 column `col`.
    public enum EnterPlan: Equatable, Sendable {
        /// the editor's plain newline
        case newline
        /// insert "\n" + prefix at the cursor
        case `continue`(prefix: String)
        /// delete [from, to) of the line and stay on it
        case exit(from: Int, to: Int)
    }

    nonisolated(unsafe) private static let listMark = try! NSRegularExpression(pattern: "^(\\s*)([-*+]|(\\d+)\\.)(\\s+)")

    /// Enter on a task line starts the next task (same indentation, always
    /// /TODO — nobody wants a second DONE); on a list item, the next item. An
    /// empty task or item ends the run: the marker goes and the line stays. The
    /// cursor inside or before the marker gets a plain newline, as does any
    /// other line.
    public static func planEnter(line: String, col: Int) -> EnterPlan {
        let u = Array(line.utf16)
        func rest(after n: Int) -> String { String(utf16CodeUnits: Array(u.dropFirst(n)), count: max(0, u.count - n)) }
        if let tag = tag(of: line) {
            let hasSpace = tag.length < u.count && u[tag.length] == 0x20
            let markerEnd = tag.length + (hasSpace ? 1 : 0)
            let empty = rest(after: tag.length).trimmingCharacters(in: .whitespaces).isEmpty
            if col < markerEnd && !(col == tag.length && empty) { return .newline }
            if empty { return .exit(from: tag.indent.utf16.count, to: u.count) }
            return .continue(prefix: tag.indent + "/TODO ")
        }
        let ns = line as NSString
        if let m = listMark.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) {
            let markerEnd = m.range.length
            if col < markerEnd { return .newline }
            let indent = ns.substring(with: m.range(at: 1))
            if rest(after: markerEnd).trimmingCharacters(in: .whitespaces).isEmpty {
                return .exit(from: indent.utf16.count, to: u.count)
            }
            let marker: String
            if m.range(at: 3).location != NSNotFound, let n = Int(ns.substring(with: m.range(at: 3))) {
                marker = "\(n + 1)."
            } else {
                marker = ns.substring(with: m.range(at: 2))
            }
            return .continue(prefix: indent + marker + " ")
        }
        return .newline
    }
}
