// The note as the editor holds it, and the two directions between that and
// the plain text in the file. Storage differs from the file in one way only:
// every tag at the start of a line is one attachment character. Everything
// else is the same text, so `plainText` is exact and cheap.

import ParkerCore
import UIKit

enum NoteStorage {
    /// The text size, the way the Mac's interface zoom sets it: chosen once by
    /// pinching, remembered. Larger than the Mac's 14px by default, because a
    /// phone is read at arm's length and a box has to be hit with a thumb.
    static let defaultFontSize: CGFloat = 17
    static let fontSizeRange: ClosedRange<CGFloat> = 13...30
    static var fontSize: CGFloat {
        get {
            let v = UserDefaults.standard.double(forKey: "editorFontSize")
            return v > 0 ? CGFloat(v) : defaultFontSize
        }
        set { UserDefaults.standard.set(Double(min(max(newValue, fontSizeRange.lowerBound), fontSizeRange.upperBound)), forKey: "editorFontSize") }
    }
    static let lineHeightMultiple: CGFloat = 1.6

    /// Geist Mono, the Mac editor's face, bundled with the app. Ligatures off,
    /// as on the Mac by default: in prose an "->" turning into an arrow is a
    /// surprise. The system's monospace stands in if the font ever fails to load.
    static var font: UIFont { geist("GeistMono-Regular", weight: .regular) }
    static var bold: UIFont { geist("GeistMono-Bold", weight: .bold) }
    static var italic: UIFont { geist("GeistMono-Italic", weight: .regular) }
    static var boldItalic: UIFont { geist("GeistMono-BoldItalic", weight: .bold) }

    private static func geist(_ name: String, weight: UIFont.Weight) -> UIFont {
        guard let base = UIFont(name: name, size: fontSize) else { return .monospacedSystemFont(ofSize: fontSize, weight: weight) }
        let noLigatures: [UIFontDescriptor.FeatureKey: Int] = [.type: kLigaturesType, .selector: kCommonLigaturesOffSelector]
        let descriptor = base.fontDescriptor.addingAttributes([.featureSettings: [noLigatures]])
        return UIFont(descriptor: descriptor, size: fontSize)
    }

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

    // ---- Offsets: storage (one char per box) <-> file (the whole tag) --------------------

    /// The file offset that storage offset `storage` stands for.
    static func fileOffset(in s: NSAttributedString, storage: Int) -> Int {
        var out = 0
        s.enumerateAttribute(.attachment, in: NSRange(location: 0, length: s.length)) { value, r, stop in
            if r.location >= storage { stop.pointee = true; return }
            if let a = value as? TodoAttachment { out += a.tagText.utf16.count }
            else { out += min(r.length, storage - r.location) }
        }
        return out
    }

    /// The storage offset for file offset `file`; a position inside a tag
    /// lands just before its box.
    static func storageOffset(in s: NSAttributedString, file: Int) -> Int {
        var acc = 0, result = s.length
        s.enumerateAttribute(.attachment, in: NSRange(location: 0, length: s.length)) { value, r, stop in
            if let a = value as? TodoAttachment {
                let n = a.tagText.utf16.count
                if file < acc + n { result = r.location; stop.pointee = true; return }
                acc += n
            } else {
                if file <= acc + r.length { result = r.location + (file - acc); stop.pointee = true; return }
                acc += r.length
            }
        }
        return result
    }

    // ---- Styling: the Mac's colours, line by line ----------------------------------------

    static func style(_ s: NSMutableAttributedString, theme: Theme) {
        let whole = NSRange(location: 0, length: s.length)
        let para = NSMutableParagraphStyle()
        // CSS `line-height: 1.6` is 1.6 × the font size; TextKit's multiple
        // would scale the font's own (taller) line height instead. Fix the
        // line and centre the text in it, as a browser does.
        let lineHeight = (fontSize * lineHeightMultiple).rounded()
        para.minimumLineHeight = lineHeight
        para.maximumLineHeight = lineHeight
        let leading = (lineHeight - font.lineHeight) / 2
        // addAttributes, never setAttributes: the latter would strip the
        // .attachment attribute and turn every box back into a blank.
        s.addAttributes([.font: font, .foregroundColor: UIColor(theme.editorFg), .paragraphStyle: para, .baselineOffset: leading], range: whole)

        // Who owns each line, from the file's text — the grammar works on that.
        // Storage lines and file lines match one to one: an attachment is one
        // character and never a newline.
        let doc = TextDocument(plainText(s))
        let owners = Todo.ownersForRange(doc, fromLine: 1, toLine: doc.lineCount)

        let ns = s.string as NSString
        var location = 0
        var inFence = false
        for (i, storageLine) in s.string.components(separatedBy: "\n").enumerated() {
            let length = (storageLine as NSString).length
            let range = NSRange(location: location, length: length)
            location += length + 1
            guard length > 0, i < doc.lineCount else { continue }
            let fileLine = doc.line(i + 1).text
            // A fenced block: its fences and its text wear the code colour,
            // and nothing inside is markdown. (The Mac highlights a named
            // language properly; this is the plain-fence look for all of them.)
            if fileLine.hasPrefix("```") || fileLine.hasPrefix("~~~") {
                inFence.toggle()
                s.addAttribute(.foregroundColor, value: UIColor(Color(css: theme.def.syntax.inlineCode)), range: range)
                continue
            }
            if inFence {
                s.addAttribute(.foregroundColor, value: UIColor(Color(css: theme.def.syntax.inlineCode)), range: range)
                continue
            }
            if let tag = Todo.tag(of: fileLine) {
                let color = tag.state == .todo ? theme.editorFg : (tag.state == .cancel ? theme.muted : theme.stateColor(tag.state))
                s.addAttribute(.foregroundColor, value: UIColor(color), range: range)
            } else if let owner = owners[i] {
                // a nested line wears its to-do's colour, 55% into the background — App.css
                // .cm-todo-child-*, whose colour wins over the marks inside the line
                let base = owner == .cancel ? theme.muted : theme.stateColor(owner)
                s.addAttribute(.foregroundColor, value: UIColor(base).blended(with: UIColor(theme.editorBg), t: 0.45), range: range)
                continue
            }
            // marks keep their own colours inside a to-do line, as the Mac's syntax spans
            // do — matched on the STORAGE line, whose offsets are the range's (a box is
            // one character where the file has the whole tag)
            markdown(storageLine, in: range, of: s, theme: theme)
        }
        _ = ns
    }

    /// The patterns, compiled once: a note is restyled on every keystroke.
    private enum Re {
        static let heading = try! NSRegularExpression(pattern: "^#{1,6} .*$")
        static let quote = try! NSRegularExpression(pattern: "^\\s*>.*$")
        // the whole item, as the Mac does (BulletList/OrderedList → t.list)
        static let list = try! NSRegularExpression(pattern: "^\\s*([-*+]|\\d+\\.) .*$")
        static let boldItalic = try! NSRegularExpression(pattern: "\\*\\*\\*[^*\\n]+?\\*\\*\\*|___[^_\\n]+?___")
        // *x* or _x_, not touching ** / __ and not across spaces at the edges
        static let italic = try! NSRegularExpression(pattern: "(?<![*\\w])\\*(?!\\*)[^*\\n]+?\\*(?!\\*)|(?<![_\\w])_(?!_)[^_\\n]+?_(?![_\\w])")
        static let bold = try! NSRegularExpression(pattern: "\\*\\*[^*\\n]+?\\*\\*|__[^_\\n]+?__")
        static let code = try! NSRegularExpression(pattern: "`[^`\\n]+`")
        // [text](url) only: a bare url is plain text on the Mac too
        static let link = try! NSRegularExpression(pattern: "\\[[^\\]]+\\]\\([^)]+\\)")
    }

    /// A little of the Mac's markdown tint: headings, list markers, bold, italic, inline code, links.
    private static func markdown(_ line: String, in range: NSRange, of s: NSMutableAttributedString, theme: Theme) {
        let ns = line as NSString
        // The Mac's rules (themes.ts syntaxStyles): marks (#, **, [], ()) wear
        // the colour of what they mark, bold-italic is bold's colour in italic.
        func paint(_ re: NSRegularExpression, _ color: Color, bold: Bool = false, italic: Bool = false, underline: Bool = false) {
            for m in re.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
                let r = NSRange(location: range.location + m.range.location, length: min(m.range.length, range.length - m.range.location))
                guard r.length > 0 else { continue }
                s.addAttribute(.foregroundColor, value: UIColor(color), range: r)
                if bold || italic {
                    let wasItalic = (s.attribute(.font, at: r.location, effectiveRange: nil) as? UIFont).map { $0.fontDescriptor.symbolicTraits.contains(.traitItalic) } ?? false
                    let wasBold = (s.attribute(.font, at: r.location, effectiveRange: nil) as? UIFont).map { $0.fontDescriptor.symbolicTraits.contains(.traitBold) } ?? false
                    let b = bold || wasBold, i = italic || wasItalic
                    s.addAttribute(.font, value: b && i ? boldItalic : b ? self.bold : i ? self.italic : font, range: r)
                }
                if underline { s.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: r) }
            }
        }
        if line.hasPrefix("#") { paint(Re.heading, theme.heading, bold: true); return }
        paint(Re.quote, Color(css: theme.def.syntax.string))
        paint(Re.list, theme.list)
        paint(Re.boldItalic, Color(css: theme.def.syntax.bold), bold: true, italic: true)
        paint(Re.italic, Color(css: theme.def.syntax.italic), italic: true)
        paint(Re.bold, Color(css: theme.def.syntax.bold), bold: true)
        paint(Re.code, Color(css: theme.def.syntax.inlineCode))
        paint(Re.link, Color(css: theme.def.syntax.link), underline: true)
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
