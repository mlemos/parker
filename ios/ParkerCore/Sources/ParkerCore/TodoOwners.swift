// Grouping: a to-do owns the lines nested under it. Ownership is indentation —
// a line belongs to the nearest to-do above it that is *less* indented, and the
// group ends at the first line that steps back out to that level or further.
// Blank lines are transparent. To-dos can nest, so this is a stack.

import Foundation

extension Todo {
    /// How far a line is indented, counting a tab as one level like the text does.
    static func indentOf(_ text: String) -> Int {
        var n = 0
        for u in text.utf16 {
            if u == 0x20 || u == 0x09 { n += 1 } else { break }
        }
        return n
    }

    /// How far back to look for the start of the enclosing group when asked
    /// about a line in the middle of a document. Bounded so a file with no
    /// unindented line anywhere can't turn this into a full-document scan.
    static let lookback = 500

    /// For each line in `fromLine...toLine` (1-based), the state of the to-do
    /// that owns it — or nil when nothing does, including for the to-do lines
    /// themselves, which wear their own state rather than inheriting one.
    ///
    /// Correct regardless of where the range starts: it walks back to the
    /// enclosing unindented line first, because a viewport can open anywhere.
    public static func ownersForRange(_ doc: TextDocument, fromLine: Int, toLine: Int) -> [TodoState?] {
        var start = fromLine
        let floor = max(1, fromLine - lookback)
        while start > floor {
            let text = doc.line(start).text
            if !isBlank(text) && indentOf(text) == 0 { break } // a root line: nothing above it can own us
            start -= 1
        }

        var stack: [(indent: Int, state: TodoState)] = []
        var owners: [TodoState?] = []

        for n in start...toLine {
            let text = doc.line(n).text
            var owner: TodoState? = nil

            if !isBlank(text) {
                let indent = indentOf(text)
                // Stepping back to this level or further leaves those groups behind.
                while let top = stack.last, top.indent >= indent { stack.removeLast() }

                if let t = tag(of: text) {
                    stack.append((indent, t.state))
                } else if let top = stack.last {
                    owner = top.state
                }
            }

            if n >= fromLine { owners.append(owner) }
        }
        return owners
    }
}
