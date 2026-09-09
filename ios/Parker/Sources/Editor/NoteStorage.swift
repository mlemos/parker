// The note as the editor holds it, and the two directions between that and
// the plain text in the file. Storage differs from the file in one way only:
// every tag at the start of a line is one attachment character. Everything
// else is the same text, so `plainText` is exact and cheap.

import ParkerCore
import UIKit

enum NoteStorage {
    static let fontSize: CGFloat = 15
    static let lineHeightMultiple: CGFloat = 1.6
    static var font: UIFont { .monospacedSystemFont(ofSize: fontSize, weight: .regular) }

    /// File text → editor storage, styled.
    static func attributed(from text: String, theme: Theme) -> NSMutableAttributedString {
        let out = NSMutableAttributedString()
        let lines = text.components(separatedBy: "\n")
        Perf.timed("paragraphs \(lines.count) lines") {
            for (i, line) in lines.enumerated() {
                out.append(paragraph(from: line, theme: theme))
                if i < lines.count - 1 { out.append(NSAttributedString(string: "\n")) }
            }
        }
        Perf.timed("style") { style(out, theme: theme) }
        return out
    }

    /// One line of file text → its storage form (tag → attachment), unstyled.
    static func paragraph(from line: String, theme: Theme) -> NSAttributedString {
        if let tag = Todo.tag(of: line) {
            let rest = String(line.utf16.dropFirst(tag.length)) ?? ""
            let s = NSMutableAttributedString(string: tag.indent)
            s.append(NSAttributedString(attachment: TodoAttachment(state: tag.state, bangs: tag.bangs, em: fontSize, theme: theme)))
            s.append(NSAttributedString(string: rest))
            return s
        }
        return NSAttributedString(string: line)
    }

    /// Editor storage → file text: attachments become their tags again.
    static func plainText(_ s: NSAttributedString) -> String {
        var out = ""
        let ns = s.string as NSString
        s.enumerateAttribute(.attachment, in: NSRange(location: 0, length: s.length)) { value, range, _ in
            if let a = value as? TodoAttachment { out += a.tagText } else { out += ns.substring(with: range) }
        }
        return out
    }

    // ---- Styling: the Mac's colours, line by line ----------------------------------------

    static func style(_ s: NSMutableAttributedString, theme: Theme) {
        let whole = NSRange(location: 0, length: s.length)
        let para = NSMutableParagraphStyle()
        para.lineHeightMultiple = lineHeightMultiple
        // addAttributes, never setAttributes: the latter would strip the
        // .attachment attribute and turn every box back into a blank.
        s.addAttributes([.font: font, .foregroundColor: UIColor(theme.editorFg), .paragraphStyle: para], range: whole)

        // Who owns each line, from the file's text — the grammar works on that.
        // Storage lines and file lines match one to one: an attachment is one
        // character and never a newline.
        let doc = TextDocument(plainText(s))
        let owners = Todo.ownersForRange(doc, fromLine: 1, toLine: doc.lineCount)

        let ns = s.string as NSString
        var location = 0
        for (i, storageLine) in s.string.components(separatedBy: "\n").enumerated() {
            let length = (storageLine as NSString).length
            let range = NSRange(location: location, length: length)
            location += length + 1
            guard length > 0, i < doc.lineCount else { continue }
            let fileLine = doc.line(i + 1).text
            if let tag = Todo.tag(of: fileLine) {
                let color = tag.state == .todo ? theme.editorFg : (tag.state == .cancel ? theme.muted : theme.stateColor(tag.state))
                s.addAttribute(.foregroundColor, value: UIColor(color), range: range)
            } else if let owner = owners[i] {
                // a nested line wears its to-do's colour, 55% into the background — App.css .cm-todo-child-*
                let base = owner == .cancel ? theme.muted : theme.stateColor(owner)
                s.addAttribute(.foregroundColor, value: UIColor(base).blended(with: UIColor(theme.editorBg), t: 0.45), range: range)
            } else {
                markdown(fileLine, in: range, of: s, theme: theme)
            }
        }
        _ = ns
    }

    /// A little of the Mac's markdown tint: headings, list markers, bold, inline code, links.
    private static func markdown(_ line: String, in range: NSRange, of s: NSMutableAttributedString, theme: Theme) {
        let ns = line as NSString
        func paint(_ pattern: String, _ color: Color, bold: Bool = false) {
            guard let re = try? NSRegularExpression(pattern: pattern) else { return }
            for m in re.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
                let r = NSRange(location: range.location + m.range.location, length: min(m.range.length, range.length - m.range.location))
                guard r.length > 0 else { continue }
                s.addAttribute(.foregroundColor, value: UIColor(color), range: r)
                if bold { s.addAttribute(.font, value: UIFont.monospacedSystemFont(ofSize: fontSize, weight: .bold), range: r) }
            }
        }
        if line.hasPrefix("#") { paint("^#{1,6} .*$", theme.heading, bold: true); return }
        paint("^\\s*([-*+]|\\d+\\.)(?= )", theme.list)
        paint("\\*\\*[^*]+\\*\\*", Color(css: theme.def.syntax.bold), bold: true)
        paint("`[^`]+`", Color(css: theme.def.syntax.inlineCode))
        paint("\\[[^\\]]+\\]\\([^)]+\\)|https?://\\S+", Color(css: theme.def.syntax.link))
    }
}

import SwiftUI
extension UIColor {
    func blended(with other: UIColor, t: CGFloat) -> UIColor {
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        getRed(&r1, green: &g1, blue: &b1, alpha: &a1); other.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return UIColor(red: r1 + (r2 - r1) * t, green: g1 + (g2 - g1) * t, blue: b1 + (b2 - b1) * t, alpha: 1)
    }
}
