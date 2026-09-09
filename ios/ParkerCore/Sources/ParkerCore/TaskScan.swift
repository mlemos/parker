// The Tasks view's data: every slash-tagged line in every note, with what is
// nested under it. Ownership is the same indentation rule as ownersForRange —
// a line belongs to the nearest to-do above it that is less indented, blank
// lines are transparent, to-dos nest — so the phone's list and the Mac's
// editor agree on who owns what.

import Foundation

public struct TaskItem: Equatable, Sendable {
    /// The note the line lives in (bare filename).
    public let note: String
    /// 1-based line number in the note.
    public let line: Int
    /// Leading whitespace count — depth, as the text has it.
    public let indent: Int
    public let state: TodoState
    /// Priority, 0 (none) to 3 — the bangs on the tag.
    public let priority: Int
    /// The text after the tag and its separating space.
    public let text: String
    /// Line number of the enclosing to-do, when this one is nested.
    public let parentLine: Int?
    /// Plain (untagged) lines nested directly under this to-do, trimmed —
    /// the "- like this one" details. Nested to-dos are items of their own.
    public let details: [String]
}

extension Todo {
    /// Every to-do in one note, in document order.
    public static func scan(note: String, _ doc: TextDocument) -> [TaskItem] {
        var items: [TaskItem] = []
        var details: [[String]] = []          // parallel to items
        var stack: [(indent: Int, index: Int)] = []

        for n in 1...doc.lineCount {
            let text = doc.line(n).text
            if isBlank(text) { continue }      // transparent: an empty line has not left the nesting
            let indent = indentOf(text)
            while let top = stack.last, top.indent >= indent { stack.removeLast() }

            if let t = tag(of: text) {
                var body = String(text.utf16.dropFirst(t.length))!
                if body.hasPrefix(" ") { body.removeFirst() }
                items.append(TaskItem(
                    note: note, line: n, indent: indent, state: t.state, priority: t.priority, text: body,
                    parentLine: stack.last.map { items[$0.index].line }, details: []
                ))
                details.append([])
                stack.append((indent, items.count - 1))
            } else if let top = stack.last {
                details[top.index].append(text.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }
        return zip(items, details).map { item, d in
            TaskItem(note: item.note, line: item.line, indent: item.indent, state: item.state, priority: item.priority,
                     text: item.text, parentLine: item.parentLine, details: d)
        }
    }

    /// The by-state view: states in the ⌘⏎ order, each with its items by
    /// priority (!!! first) and, within a priority, in the order the notes
    /// were given — the only place priority reorders anything; the by-note
    /// view and the editor keep the document's order. States with no items
    /// are omitted.
    public static func groupByState(_ items: [TaskItem]) -> [(state: TodoState, items: [TaskItem])] {
        TodoState.order.compactMap { st in
            let group = items.enumerated()
                .filter { $0.element.state == st }
                .sorted { a, b in
                    a.element.priority != b.element.priority ? a.element.priority > b.element.priority : a.offset < b.offset
                }
                .map(\.element)
            return group.isEmpty ? nil : (st, group)
        }
    }

    /// "Note › parent › grandparent" for a nested item — what the by-state view
    /// shows above a task that lives inside another. `items` must be the scan
    /// of the same note.
    public static func path(of item: TaskItem, in items: [TaskItem]) -> [String] {
        var chain: [String] = []
        var cur = item
        while let p = cur.parentLine, let parent = items.first(where: { $0.note == cur.note && $0.line == p }) {
            chain.insert(parent.text, at: 0)
            cur = parent
        }
        return [item.note] + chain
    }

    /// Where "Add task" puts a new to-do: a `/TODO text` line after the note's
    /// last to-do (and whatever is nested under it), or at the end of the note
    /// when it has none. Returns the edit and the line the new task lands on.
    public static func appendTask(_ text: String, to doc: TextDocument) -> (change: Change, line: Int) {
        let items = scan(note: "", doc)
        let insertAfter: Int   // 1-based line number the new line follows; 0 = at the very top
        if let last = items.last {
            // The last to-do's group ends at the first later line that steps back
            // out to its indent or further (blank lines are transparent, so a
            // trailing blank run is skipped too).
            var end = last.line
            var n = last.line + 1
            while n <= doc.lineCount {
                let t = doc.line(n).text
                if !isBlank(t) {
                    if indentOf(t) <= last.indent { break }
                    end = n
                }
                n += 1
            }
            insertAfter = end
        } else {
            insertAfter = doc.lineCount
        }
        let indentText = items.last.map { String(repeating: " ", count: $0.indent) } ?? ""
        let newLine = indentText + "/TODO " + text
        // An empty note: the task becomes its first line.
        if insertAfter == 0 || (doc.lineCount == 1 && isBlank(doc.line(1).text)) {
            return (Change(from: 0, insert: newLine + "\n"), 1)
        }
        let anchor = doc.line(insertAfter)
        // A note ending in a blank last line gets the task before that blank,
        // keeping the trailing newline the file already had.
        if insertAfter == doc.lineCount && isBlank(anchor.text) && doc.lineCount > 1 {
            let prev = doc.line(insertAfter - 1)
            return (Change(from: prev.to, insert: "\n" + newLine), insertAfter)
        }
        return (Change(from: anchor.to, insert: "\n" + newLine), insertAfter + 1)
    }
}
