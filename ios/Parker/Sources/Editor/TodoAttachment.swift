// The checkbox inside the text: an attachment that stands in for the tag
// (`/TODO!!`) and draws the box the Mac draws — the state's fill, the Mac's
// glyph, the priority as the empty box's border. The tag itself is kept on the
// attachment, so the note's plain text is always recoverable, character for
// character: the attachment is how the tag looks, not what the note says.
//
// The attachment is laid out one column wide — the width a list marker (`-`)
// takes — so the text of a to-do starts where the text of a list item starts
// and a mixed list reads as one list, as on the Mac (App.css .cm-todo-box).
// The square is wider than a column, so it is not drawn by the attachment,
// whose image would be squeezed into its cell: BoxLayoutManager paints it over
// the cell, overflowing into the space that follows the tag in the text.

import ParkerCore
import UIKit

final class TodoAttachment: NSTextAttachment {
    let state: TodoState
    let bangs: String
    let em: CGFloat
    /// The square and its offset, as drawn — wider than the cell.
    let boxImage: UIImage

    /// The tag exactly as it is written in the file.
    var tagText: String { "/" + state.rawValue + bangs }
    var priority: Int { bangs.utf16.count }

    /// The Mac's geometry (App.css --todo-box-*): the square is 0.8em, centred
    /// on the column — where a list marker's `-` is centred, so the two sit on
    /// one axis — and what is left of the two columns `/TODO ` takes is the
    /// gap to the text. The glyph is 0.5em, the radius 0.3 of the side.
    static func boxSide(em: CGFloat) -> CGFloat { em * 0.8 }
    /// Where the square starts, from the cell's left edge: a little before it.
    static func boxOffset(em: CGFloat, column: CGFloat) -> CGFloat { column / 2 - boxSide(em: em) / 2 }
    /// How far the drawing reaches past the cell's left edge.
    var drawnWidth: CGFloat { Self.boxOffset(em: em, column: column) + Self.boxSide(em: em) }
    let column: CGFloat

    init(state: TodoState, bangs: String, em: CGFloat, column: CGFloat, theme: Theme) {
        self.state = state
        self.bangs = bangs
        self.em = em
        self.column = column
        boxImage = Self.render(state: state, priority: bangs.utf16.count, em: em, column: column, theme: theme)
        super.init(data: nil, ofType: nil)
        // Nothing for the attachment itself to draw: the layout manager paints
        // the box. A clear pixel rather than no image, so UIKit has nothing
        // to stand in with.
        image = Self.clear
        // The cell: one column wide, the square's height, its bottom a
        // little under the baseline as on the Mac (vertical-align -0.05em).
        let box = Self.boxSide(em: em), unit = em / 14
        bounds = CGRect(x: 0, y: -(em * 0.05) - (box - em * 0.75) / 2 + 1 * unit, width: column, height: box)
    }

    private static let clear: UIImage = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1)).image { _ in }

    required init?(coder: NSCoder) { fatalError("not used") }

    // ---- Drawing ---------------------------------------------------------------------

    nonisolated(unsafe) private static var glyphs: [TodoState: Glyph?] = [:]
    nonisolated(unsafe) private static var cache: [String: UIImage] = [:]

    /// The square alone; BoxLayoutManager places it at the cell's offset.
    static func render(state: TodoState, priority: Int, em: CGFloat, column: CGFloat, theme: Theme) -> UIImage {
        let key = "\(state.rawValue)-\(priority)-\(em)-\(theme.def.id)"
        if let img = cache[key] { return img }
        let box = boxSide(em: em)
        // Every measure is the Mac's at 14px, scaled with the size — the way the
        // Mac's interface zoom scales the whole box — so a pinch keeps its shape.
        let unit = em / 14
        let size = CGSize(width: box, height: box)
        let scale = UIScreen.main.scale
        let img = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = scale; f.opaque = false; return f }()).image { ctx in
            let c = ctx.cgContext
            let rect = CGRect(x: 0, y: 0, width: box, height: box)
            let filled = state != .todo
            let fill = filled ? (state == .cancel ? theme.muted : theme.stateColor(state)) : nil
            let border = filled ? fill! : theme.priorityColor(priority)
            // 1.5px border on the Mac's 14px, OUTER radius 0.3 of the side: the
            // stroke is centred on the path, so the path sits half a stroke in
            // and its radius is half a stroke less.
            let inset = 0.75 * unit
            let path = UIBezierPath(roundedRect: rect.insetBy(dx: inset, dy: inset), cornerRadius: box * 0.3 - inset)
            if let fill { c.setFillColor(UIColor(fill).cgColor); c.addPath(path.cgPath); c.fillPath() }
            c.setStrokeColor(UIColor(border).cgColor); c.setLineWidth(1.5 * unit); c.addPath(path.cgPath); c.strokePath()
            // the glyph: 0.5em, centred — knocked out in the editor's background
            if state != .todo, let glyph = glyph(for: state, theme: theme) {
                let g = em * 0.5
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
