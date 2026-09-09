// The checkbox inside the text: an attachment that stands in for the tag
// (`/TODO!!`) and draws the box the Mac draws — the state's fill, the Mac's
// glyph, the priority as the empty box's border. The tag itself is kept on the
// attachment, so the note's plain text is always recoverable, character for
// character: the attachment is how the tag looks, not what the note says.

import ParkerCore
import UIKit

final class TodoAttachment: NSTextAttachment {
    let state: TodoState
    let bangs: String
    let em: CGFloat

    /// The tag exactly as it is written in the file.
    var tagText: String { "/" + state.rawValue + bangs }
    var priority: Int { bangs.utf16.count }

    init(state: TodoState, bangs: String, em: CGFloat, theme: Theme) {
        self.state = state
        self.bangs = bangs
        self.em = em
        super.init(data: nil, ofType: nil)
        image = Self.render(state: state, priority: bangs.utf16.count, em: em, theme: theme)
        // The Mac's box: 0.95em, with 3px before and 1px after (the space that
        // follows the tag in the text brings the rest of the gap).
        let box = em * 0.95
        bounds = CGRect(x: 0, y: -(em * 0.07) - (box - em * 0.75) / 2 + 1, width: 3 + box + 1, height: box)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    // ---- Drawing ---------------------------------------------------------------------

    nonisolated(unsafe) private static var glyphs: [TodoState: Glyph?] = [:]
    nonisolated(unsafe) private static var cache: [String: UIImage] = [:]

    static func render(state: TodoState, priority: Int, em: CGFloat, theme: Theme) -> UIImage {
        let key = "\(state.rawValue)-\(priority)-\(em)-\(theme.def.id)"
        if let img = cache[key] { return img }
        let box = em * 0.95
        let size = CGSize(width: 3 + box + 1, height: box)
        let scale = UIScreen.main.scale
        let img = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = scale; f.opaque = false; return f }()).image { ctx in
            let c = ctx.cgContext
            let rect = CGRect(x: 3, y: 0, width: box, height: box)
            let filled = state != .todo
            let fill = filled ? (state == .cancel ? theme.muted : theme.stateColor(state)) : nil
            let border = filled ? fill! : theme.priorityColor(priority)
            // the Mac's 4px radius on a 13px box: it scales with the box, or a small one turns round
            let path = UIBezierPath(roundedRect: rect.insetBy(dx: 0.75, dy: 0.75), cornerRadius: box * 0.3)
            if let fill { c.setFillColor(UIColor(fill).cgColor); c.addPath(path.cgPath); c.fillPath() }
            c.setStrokeColor(UIColor(border).cgColor); c.setLineWidth(1.5); c.addPath(path.cgPath); c.strokePath()
            // the glyph: 0.85em of a 0.7em font, centred — knocked out in the editor's background
            if state != .todo, let glyph = glyph(for: state, theme: theme) {
                let g = em * 0.7 * 0.85
                let k = g / Glyph.gridSize
                let origin = CGPoint(x: rect.midX - g / 2, y: rect.midY - g / 2)
                let t = CGAffineTransform(translationX: origin.x, y: origin.y).scaledBy(x: k, y: k)
                c.setFillColor(UIColor(theme.editorBg).cgColor); c.setStrokeColor(UIColor(theme.editorBg).cgColor)
                c.setLineCap(.round); c.setLineJoin(.round)
                for shape in glyph.shapes {
                    let p = shape.path.copy(using: [t]) ?? shape.path
                    if shape.filled { c.addPath(p); c.fillPath() }
                    c.setLineWidth(shape.strokeWidth * k); c.addPath(p); c.strokePath()
                }
            }
        }
        cache[key] = img
        return img
    }

    private static func glyph(for state: TodoState, theme: Theme) -> Glyph? {
        if let g = glyphs[state] { return g }
        let g = try? GlyphSVG.parse(theme.tokens.todo.glyphs[state.rawValue] ?? "")
        glyphs[state] = g
        return g
    }
}
