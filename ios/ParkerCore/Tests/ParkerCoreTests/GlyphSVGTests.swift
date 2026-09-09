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

    // The point of this test is that we apply the SAME transform the Mac does —
    // a wrong arc or a dropped translate would miss by units, not hundredths.
    // Every glyph's longest side lands on 16 of the 24 grid. Six are centred on
    // 12; the play is deliberately not: its INK box is declared 3…21 so that
    // Lucide's own optical offset (the triangle sits one unit right of centre
    // in Lucide's grid) survives the normalisation — centre 12.889.
    @Test("the ink is normalised: longest side 16 units, centred like the Mac")
    func normalised() throws {
        for st in TodoState.order where st != .todo {
            let g = try #require(try GlyphSVG.parse(Self.tokens.todo.glyphs[st.rawValue]!))
            let box = g.path.boundingBoxOfPath
            let longest = max(box.width, box.height)
            let midX: CGFloat = st == .doing ? 12.889 : 12
            #expect(abs(longest - 16) < 0.05, Comment(rawValue: "\(st): longest side \(longest)"))
            #expect(abs(box.midX - midX) < 0.05 && abs(box.midY - 12) < 0.05, Comment(rawValue: "\(st): centre \(box.midX),\(box.midY)"))
        }
    }

    // The pen decided on the spec: play, pause and the hourglass's bulbs are
    // solid with a 1.2 stroke; check, x, asterisk and minus are lines at 4;
    // the hourglass's caps are lines at 2.5. Widths come back in grid units,
    // after the group's scale, so they read like the spec.
    @Test("reads the pen per shape: solids thin and filled, lines heavy, the hourglass mixed")
    func pen() throws {
        func glyph(_ st: TodoState) throws -> Glyph { try #require(try GlyphSVG.parse(Self.tokens.todo.glyphs[st.rawValue]!)) }
        for st in [TodoState.done, .fail, .attn, .cancel] {
            let g = try glyph(st)
            #expect(g.shapes.allSatisfy { !$0.filled && abs($0.strokeWidth - 4) < 0.02 }, Comment(rawValue: "\(st)"))
        }
        for st in [TodoState.doing, .pause] {
            let g = try glyph(st)
            #expect(g.shapes.allSatisfy { $0.filled && abs($0.strokeWidth - 1.2) < 0.02 }, Comment(rawValue: "\(st)"))
        }
        let wait = try glyph(.wait)
        #expect(wait.shapes.count == 4)
        #expect(wait.shapes[0...1].allSatisfy { !$0.filled && abs($0.strokeWidth - 2.5) < 0.02 })
        #expect(wait.shapes[2...3].allSatisfy { $0.filled && abs($0.strokeWidth - 1.2) < 0.02 })
        #expect(abs(wait.strokeWidth - 2.5) < 0.02)
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
