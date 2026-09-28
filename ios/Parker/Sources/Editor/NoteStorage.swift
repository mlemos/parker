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

    /// One column of the monospace face: what a list marker takes, and what a
    /// to-do's box is laid out as (TodoAttachment). Measured once per size —
    /// it is asked for on every to-do line of every note.
    static var column: CGFloat {
        if let c = columnCache, c.size == fontSize { return c.width }
        let width = ("0" as NSString).size(withAttributes: [.font: font]).width
        columnCache = (fontSize, width)
        return width
    }
    nonisolated(unsafe) private static var columnCache: (size: CGFloat, width: CGFloat)?

    private static func geist(_ name: String, weight: UIFont.Weight) -> UIFont {
        guard let base = UIFont(name: name, size: fontSize) else { return .monospacedSystemFont(ofSize: fontSize, weight: weight) }
        let noLigatures: [UIFontDescriptor.FeatureKey: Int] = [.type: kLigaturesType, .selector: kCommonLigaturesOffSelector]
        let descriptor = base.fontDescriptor.addingAttributes([.featureSettings: [noLigatures]])
        return UIFont(descriptor: descriptor, size: fontSize)
    }

    /// File text → editor storage, styled.
    @MainActor static func attributed(from text: String, theme: Theme) -> NSMutableAttributedString {
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
            s.append(NSAttributedString(attachment: TodoAttachment(state: tag.state, bangs: tag.bangs, em: fontSize, column: column, theme: theme)))
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

    /// The Mac's own painter (shared/parker-paint.js, run in JavaScriptCore):
    /// the note parsed by the Mac's parser, coloured by its stylesheet's
    /// rules. Nil only if the bundled script fails, and then a note is shown
    /// uncoloured rather than not at all.
    @MainActor static let painter: NotePainter? = {
        guard let url = Bundle.main.url(forResource: "parker-paint", withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return try? NotePainter(script: script)
    }()

    @MainActor static func style(_ s: NSMutableAttributedString, theme: Theme) {
        let whole = NSRange(location: 0, length: s.length)
        let font = self.font
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
        s.removeAttribute(.underlineStyle, range: whole)
        s.removeAttribute(.codeWash, range: whole)

        let text = plainText(s)
        let doc = TextDocument(text)
        let paints = painter?.paint(text) ?? []

        // One column of the monospace face, for the hanging indent below. The
        // box is laid out as one column too (TodoAttachment), like the list
        // marker it stands in the place of.
        let column = self.column

        var location = 0
        for (i, storageLine) in s.string.components(separatedBy: "\n").enumerated() {
            let length = (storageLine as NSString).length
            let range = NSRange(location: location, length: length)
            location += length + 1
            guard length > 0, i < doc.lineCount else { continue }
            // A wrapped list item or to-do continues under its text, not at
            // the margin — the Mac's rule, from the file's line. The paragraph
            // range includes the newline, which is where TextKit reads the
            // style of the line from.
            if let prefix = HangingIndent.prefix(of: doc.line(i + 1).text) {
                let hang = NSMutableParagraphStyle()
                hang.setParagraphStyle(para)
                hang.firstLineHeadIndent = 0
                hang.headIndent = CGFloat(prefix.cols + (prefix.box ? 1 : 0)) * column
                let paraRange = NSRange(location: range.location, length: min(length + 1, s.length - range.location))
                s.addAttribute(.paragraphStyle, value: hang, range: paraRange)
            }
            guard i < paints.count else { continue }
            paint(paints[i], in: range, of: s, theme: theme)
        }
    }

    /// One line's paint onto its storage range. The painter's offsets are the
    /// file's; in storage a to-do's tag is one character, its box.
    private static func paint(_ line: LinePaint, in range: NSRange, of s: NSMutableAttributedString, theme: Theme) {
        let storage: (Int) -> Int = { f in
            guard let tag = line.tag, tag.count == 2, f >= tag[1] else { return f }
            return f - (tag[1] - tag[0]) + 1
        }
        let bg = UIColor(theme.editorBg)
        let nested = theme.tokens.todo.nested
        for run in line.runs {
            let from = storage(run.from), to = storage(run.to)
            guard from < range.length else { continue }
            let r = NSRange(location: range.location + from, length: min(to, range.length) - from)
            guard r.length > 0 else { continue }
            var ink = UIColor(color(of: run.role, line: line, theme: theme))
            // Under a to-do: the line's colour into the page by the line's dial,
            // a mark's own colour by the marks' (App.css --todo-child-*mix).
            if line.ownerState != nil {
                ink = ink.blended(with: bg, t: 1 - CGFloat(run.isMark ? nested.marks : nested.line))
            }
            s.addAttribute(.foregroundColor, value: ink, range: r)
            if run.bold || run.italic {
                s.addAttribute(.font, value: run.bold && run.italic ? boldItalic : run.bold ? bold : italic, range: r)
            }
            if run.underline { s.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: r) }
            if let wash = run.wash {
                let (c, a) = wash == .code ? (theme.def.syntax.inlineCode, theme.tokens.washes.code) : (theme.def.syntax.highlight, theme.tokens.washes.highlight)
                s.addAttribute(.codeWash, value: UIColor(Color(css: c)).withAlphaComponent(CGFloat(a)), range: r)
            }
        }
    }

    /// A role's colour, from the theme — the same variables the Mac's
    /// stylesheet reads (App.tsx --md-*, themes.ts monoStyles).
    private static func color(of role: PaintRun.Role, line: LinePaint, theme: Theme) -> Color {
        let x = theme.def.syntax
        switch role {
        case .plain: return theme.editorFg
        case .line: return theme.stateColor(line.lineState ?? line.ownerState ?? .todo)
        case .heading: return Color(css: x.heading)
        case .quote: return Color(css: x.quote)
        case .list: return Color(css: x.list)
        case .fence, .code: return Color(css: x.inlineCode)
        case .comment: return Color(css: x.comment)
        case .string: return Color(css: x.string)
        case .label: return Color(css: x.func)
        case .italic: return Color(css: x.italic)
        case .bold: return Color(css: x.bold)
        case .boldItalic: return Color(css: x.boldItalic)
        case .link: return Color(css: x.link)
        case .url: return Color(css: x.url)
        case .highlight: return Color(css: x.highlight)
        case .strike: return Color(css: x.strike)
        }
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
