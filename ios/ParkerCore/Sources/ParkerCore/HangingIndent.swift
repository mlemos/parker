// Wrapped lines hang under their text, not under their marker — the Mac's
// rule (src/lib/hanging-indent.ts), tested against the same fixtures.
//
// A long list item or to-do that wraps continues where the item's text
// starts: after the indentation and the marker. The rule says how wide that
// prefix is, in text columns, and whether a to-do box stands in for the tag;
// the editor turns that into a paragraph's head indent.

import Foundation

public enum HangingIndent {
    public struct Prefix: Equatable, Sendable {
        /// Text columns before the content: indentation plus marker (a to-do's
        /// tag not included — that is the box).
        public let cols: Int
        /// A to-do box stands in for the tag, ahead of `cols`' trailing space.
        public let box: Bool
        public init(cols: Int, box: Bool) { self.cols = cols; self.box = box }
    }

    private static let marker = try! NSRegularExpression(
        pattern: "^(?:[-*+]|\\d{1,3}[.)]|>)[ \\t]+(?:\\[[ xX]\\][ \\t]+)?"
    )

    /// The leading part of a line the continuation should hang under, or nil
    /// when there is none (a paragraph, a heading, a blank line).
    public static func prefix(of line: String) -> Prefix? {
        let ns = line as NSString
        var ws = 0
        while ws < ns.length, let c = Unicode.Scalar(ns.character(at: ws)), c == " " || c == "\t" { ws += 1 }
        guard ws < ns.length else { return nil }

        if let tag = Todo.tag(of: line) {
            // The tag is drawn as the box; the space after it is still text.
            var gap = 0
            var i = tag.length
            while i < ns.length, let c = Unicode.Scalar(ns.character(at: i)), c == " " || c == "\t" { gap += 1; i += 1 }
            return Prefix(cols: ws + gap, box: true)
        }

        let rest = ns.substring(from: ws)
        if let m = marker.firstMatch(in: rest, range: NSRange(location: 0, length: (rest as NSString).length)) {
            return Prefix(cols: ws + m.range.length, box: false)
        }
        // Indented text with no marker still hangs under its own start.
        return ws > 0 ? Prefix(cols: ws, box: false) : nil
    }
}
