// The layout manager that paints the to-do boxes. An attachment can only draw
// inside its own cell, and a to-do's cell is one text column — the box is
// wider than that (TodoAttachment). So the text is drawn as usual, with a
// clear pixel in each cell, and the boxes are painted over the cells
// afterwards, each centred on its cell — where a list marker is centred —
// reaching a little before it and into the space that follows the tag.

import UIKit

final class BoxLayoutManager: NSLayoutManager {
    /// Inline code's wash (NoteStorage, `.codeWash`). TextKit's own
    /// `.backgroundColor` fills the whole line fragment — 1.6 lines tall —
    /// where the Mac's chip is the text's own height with a pixel to spare
    /// and rounded corners, so the wash is an attribute of ours, drawn here.
    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage, let ctx = UIGraphicsGetCurrentContext() else { return }
        let textHeight = NoteStorage.font.lineHeight + 2
        let chars = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(.codeWash, in: chars) { value, range, _ in
            guard let color = value as? UIColor else { return }
            let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphs.length > 0, let container = textContainer(forGlyphAt: glyphs.location, effectiveRange: nil) else { return }
            color.setFill()
            // One chip per line the run touches, as wide as its text on that
            // line — not to the container's edge, which is what the enclosing
            // rects of a wrapped run would give.
            var g = glyphs.location
            while g < NSMaxRange(glyphs) {
                var fragment = NSRange()
                _ = lineFragmentRect(forGlyphAt: g, effectiveRange: &fragment)
                let part = NSIntersectionRange(glyphs, fragment)
                guard part.length > 0 else { break }
                let r = boundingRect(forGlyphRange: part, in: container)
                let inset = max(0, (r.height - textHeight) / 2)
                let chip = r.insetBy(dx: 0, dy: inset).offsetBy(dx: origin.x, dy: origin.y)
                ctx.addPath(UIBezierPath(roundedRect: chip, cornerRadius: 3).cgPath)
                ctx.fillPath()
                g = NSMaxRange(fragment)
            }
        }
    }

    override func drawGlyphs(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage else { return }
        let chars = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(.attachment, in: chars) { value, range, _ in
            guard let box = value as? TodoAttachment else { return }
            let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphs.length > 0, let container = textContainer(forGlyphAt: glyphs.location, effectiveRange: nil) else { return }
            // The cell's top-left: the glyph's position on the line, and the
            // attachment's bounds hung from the baseline. (boundingRect would
            // give the whole line's height, not the cell's.)
            let fragment = lineFragmentRect(forGlyphAt: glyphs.location, effectiveRange: nil)
            let location = self.location(forGlyphAt: glyphs.location)
            let x = fragment.minX + location.x + TodoAttachment.boxOffset(em: box.em, column: box.column)
            let y = fragment.minY + location.y - box.bounds.maxY
            box.boxImage.draw(at: CGPoint(x: origin.x + x, y: origin.y + y))
        }
    }
}

extension NSAttributedString.Key {
    /// Inline code's wash colour — drawn by BoxLayoutManager, not by TextKit.
    static let codeWash = NSAttributedString.Key("parkerCodeWash")
}
