// shared/design-tokens.json is generated on the Mac side; this side must be able
// to read every field it paints from, and the grammar it carries must agree
// with the grammar compiled in here.

import Foundation
import Testing
@testable import ParkerCore

@Suite("design tokens") struct DesignTokensTests {
    static let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("shared/design-tokens.json")

    @Test("decodes, with the eight themes and a default that exists")
    func decodes() throws {
        let t = try DesignTokens.load(from: Self.url)
        #expect(t.themes.count == 8)
        #expect(t.theme(id: t.defaultThemeId) != nil)
        #expect(t.theme(id: "vercel-day")?.mode == .light)
        #expect(t.theme(id: "vercel-night")?.mode == .dark)
    }

    @Test("carries the same to-do grammar this module compiles in")
    func grammarAgrees() throws {
        let t = try DesignTokens.load(from: Self.url)
        #expect(t.todo.order == TodoState.order.map(\.rawValue))
        #expect(t.todo.aliases.mapValues { TodoState(rawValue: $0)! } == Todo.aliases)
    }

    @Test("has a glyph for every state but TODO, and a color for every state that carries one")
    func glyphsAndColors() throws {
        let t = try DesignTokens.load(from: Self.url)
        for st in TodoState.order {
            let svg = t.todo.glyphs[st.rawValue]
            if st == .todo { #expect(svg == "") } else { #expect(svg?.hasPrefix("<svg") == true, Comment(rawValue: st.rawValue)) }
        }
        for theme in t.themes {
            for st in TodoState.order {
                let c = theme.todo.color(for: st)
                #expect((c == nil) == (st == .todo || st == .cancel), Comment(rawValue: "\(theme.id) \(st)"))
                if let c { #expect(c.hasPrefix("#") || c.hasPrefix("rgba("), Comment(rawValue: c)) }
            }
        }
        #expect(t.todo.box.size == "0.95em")
    }
}
