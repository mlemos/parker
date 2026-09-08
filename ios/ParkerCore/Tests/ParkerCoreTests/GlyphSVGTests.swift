// The glyph strings in shared/design-tokens.json must parse, and the ink must
// land where the Mac's todo-glyph.ts puts it: the longest side of every glyph
// at 16 of the 24 grid units, centered on (12, 12).

import CoreGraphics
import Foundation
import Testing
@testable import ParkerCore

@Suite("glyph svg") struct GlyphSVGTests {
    static let tokens = try! DesignTokens.load(from: DesignTokensTests.url)

    @Test("every state's glyph parses; TODO is empty on purpose")
    func parses() throws {
        for st in TodoState.order {
            let g = try GlyphSVG.parse(Self.tokens.todo.glyphs[st.rawValue]!)
            #expect((g == nil) == (st == .todo), Comment(rawValue: st.rawValue))
        }
    }

    // The Mac normalises each glyph from a hand-read INK table (todo-glyph.ts),
    // so "16" is as exact as that reading: six glyphs land within 0.01, the
    // play triangle within 0.5 (its INK top is read a little high). The point
    // of this test is that we apply the SAME transform the Mac does — a wrong
    // arc or a dropped translate would miss by units, not tenths.
    @Test("the ink is normalised: longest side 16 units, centred on the grid, like the Mac")
    func normalised() throws {
        for st in TodoState.order where st != .todo {
            let g = try #require(try GlyphSVG.parse(Self.tokens.todo.glyphs[st.rawValue]!))
            let box = g.path.boundingBoxOfPath
            let longest = max(box.width, box.height)
            let tolerance: CGFloat = st == .doing ? 0.6 : 0.05
            #expect(abs(longest - 16) < tolerance, Comment(rawValue: "\(st): longest side \(longest)"))
            #expect(abs(box.midX - 12) < tolerance && abs(box.midY - 12) < tolerance, Comment(rawValue: "\(st): centre \(box.midX),\(box.midY)"))
            #expect(g.strokeWidth > 1 && g.strokeWidth < 4, Comment(rawValue: "\(st): stroke \(g.strokeWidth)"))
        }
    }

    @Test("the minus is a horizontal line, the check has the right corner")
    func shapes() throws {
        let cancel = try #require(try GlyphSVG.parse(Self.tokens.todo.glyphs["CANCEL"]!))
        let cb = cancel.path.boundingBoxOfPath
        #expect(cb.height < 0.01 && abs(cb.width - 16) < 0.05)
        // done: "M20 6 9 17l-5-5" — the elbow sits low-left of centre after scaling
        let done = try #require(try GlyphSVG.parse(Self.tokens.todo.glyphs["DONE"]!))
        let db = done.path.boundingBoxOfPath
        #expect(db.width > db.height)
    }

    @Test("arcs become curves that end exactly where the arc ends")
    func arcs() throws {
        // a full-ish arc: the play glyph closes back to its start
        let doing = try #require(try GlyphSVG.parse(Self.tokens.todo.glyphs["DOING"]!))
        #expect(!doing.path.isEmpty)
        // a unit semicircle, on its own
        let p = CGMutablePath()
        try GlyphSVG.appendPathData("M0 0A1 1 0 0 1 2 0", to: p, transform: .identity)
        let b = p.boundingBoxOfPath
        #expect(abs(b.minX) < 1e-6 && abs(b.maxX - 2) < 1e-6)
        #expect(abs(b.minY + 1) < 1e-3 && abs(b.maxY) < 1e-6)   // sweep=1 bulges to negative y (SVG y-down)
    }

    @Test("number lists split on minus signs and repeated dots, and reject junk")
    func numbers() throws {
        #expect(try GlyphSVG.numbers("2 2 0 0 1 3.008-1.728") == [2, 2, 0, 0, 1, 3.008, -1.728])
        #expect(try GlyphSVG.numbers(".5.5") == [0.5, 0.5])
        #expect(throws: GlyphSVGError.badNumber("x")) { try GlyphSVG.numbers("x") }
        #expect(throws: GlyphSVGError.unsupportedCommand("Q")) {
            try GlyphSVG.appendPathData("M0 0Q1 1 2 2", to: CGMutablePath(), transform: .identity)
        }
    }
}
