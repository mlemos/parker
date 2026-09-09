// The checkbox, exactly as the Mac draws it: a 0.95em square, a 1.5px border
// with 4px radius, the state's colour as fill, the glyph knocked out in the
// editor's background — and, on the empty box, the priority as the border's
// colour. The glyph is the Mac's own SVG, parsed by ParkerCore.GlyphSVG.

import ParkerCore
import SwiftUI

struct TodoBoxView: View {
    let state: TodoState
    let priority: Int
    let theme: Theme
    /// The line's font size: the box is 0.95em of it.
    var em: CGFloat = 15

    private static var glyphCache: [TodoState: Glyph?] = [:]

    private var glyph: Glyph? {
        if let g = Self.glyphCache[state] { return g }
        let g = try? GlyphSVG.parse(theme.tokens.todo.glyphs[state.rawValue] ?? "")
        Self.glyphCache[state] = g
        return g
    }

    var body: some View {
        let size = em * 0.95
        let filled = state != .todo
        let fill = filled ? (state == .cancel ? theme.muted : theme.stateColor(state)) : Color.clear
        let border = filled ? fill : theme.priorityColor(priority)
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                .fill(fill)
            RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                .strokeBorder(border, lineWidth: 1.5)
            if let glyph {
                GlyphShapeView(glyph: glyph, color: theme.editorBg)
                    .frame(width: em * 0.7 * 0.85, height: em * 0.7 * 0.85)
            }
        }
        .frame(width: size, height: size)
    }
}

/// Draws a parsed glyph: every shape with its own pen — solid ones filled and
/// thinly stroked, line ones stroked heavier — scaled from the 24-unit grid.
struct GlyphShapeView: View {
    let glyph: Glyph
    let color: Color

    var body: some View {
        Canvas { ctx, size in
            let k = size.width / Glyph.gridSize
            let t = CGAffineTransform(scaleX: k, y: k)
            for shape in glyph.shapes {
                let p = Path(shape.path.copy(using: [t]) ?? shape.path)
                if shape.filled { ctx.fill(p, with: .color(color)) }
                ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: shape.strokeWidth * k, lineCap: .round, lineJoin: .round))
            }
        }
    }
}
