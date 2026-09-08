// A line-addressable view of a note's text, with the offsets CodeMirror and
// UIKit both speak: UTF-16 code units. Lines are 1-based, like the editor.

import Foundation

public struct DocLine: Equatable, Sendable {
    public let number: Int   // 1-based
    public let from: Int     // UTF-16 offset of the first character
    public let to: Int       // UTF-16 offset just past the last character (no newline)
    public let text: String
}

public struct TextDocument: Sendable {
    public let lines: [String]
    private let starts: [Int]   // UTF-16 offset of each line's first character
    /// Total UTF-16 length, newlines included.
    public let length: Int

    public init(lines: [String]) {
        precondition(!lines.isEmpty, "a document has at least one (possibly empty) line")
        self.lines = lines
        var starts: [Int] = []
        var pos = 0
        for (i, l) in lines.enumerated() {
            starts.append(pos)
            pos += l.utf16.count
            if i < lines.count - 1 { pos += 1 } // the "\n" between lines
        }
        self.starts = starts
        self.length = pos
    }

    public init(_ text: String) {
        self.init(lines: text.components(separatedBy: "\n"))
    }

    public var lineCount: Int { lines.count }

    /// The line with 1-based number `n`.
    public func line(_ n: Int) -> DocLine {
        precondition(n >= 1 && n <= lines.count, "line \(n) out of range")
        let text = lines[n - 1]
        return DocLine(number: n, from: starts[n - 1], to: starts[n - 1] + text.utf16.count, text: text)
    }

    /// The line containing UTF-16 offset `pos` (a position on the newline after
    /// a line belongs to that line, as in CodeMirror).
    public func lineAt(_ pos: Int) -> DocLine {
        precondition(pos >= 0 && pos <= length, "offset \(pos) out of range")
        // binary search for the last start <= pos
        var lo = 0, hi = starts.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if starts[mid] <= pos { lo = mid } else { hi = mid - 1 }
        }
        return line(lo + 1)
    }
}
