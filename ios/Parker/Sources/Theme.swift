// The design tokens, as the phone paints them: colours by role from the same
// JSON the Mac generates (shared/design-tokens.json, bundled). Light follows
// Vercel Day, dark follows Vercel Night, like the Mac's defaults.

import ParkerCore
import SwiftUI

struct Theme {
    let def: DesignTokens.Theme
    let tokens: DesignTokens

    static let tokens: DesignTokens = {
        let url = Bundle.main.url(forResource: "design-tokens", withExtension: "json")!
        return try! DesignTokens.load(from: url)
    }()

    static func current(_ scheme: ColorScheme) -> Theme {
        let id = scheme == .dark ? "vercel-night" : "vercel-day"
        return Theme(def: tokens.theme(id: id) ?? tokens.themes[0], tokens: tokens)
    }

    var editorBg: Color { Color(css: def.ui.editorBg) }
    var editorFg: Color { Color(css: def.ui.editorFg) }
    var text: Color { Color(css: def.ui.text) }
    var secondary: Color { Color(css: def.ui.secondary) }
    var muted: Color { Color(css: def.ui.muted) }
    var border: Color { Color(css: def.ui.border) }
    var accent: Color { Color(css: def.ui.accent) }
    var heading: Color { Color(css: def.syntax.heading) }
    var list: Color { Color(css: def.syntax.list) }

    /// The colour a to-do line's text takes: TODO wears the body colour, CANCEL the muted one.
    func stateColor(_ st: TodoState) -> Color {
        switch st {
        case .todo: return editorFg
        case .cancel: return muted
        default: return Color(css: def.todo.color(for: st) ?? def.ui.editorFg)
        }
    }

    func priorityColor(_ level: Int) -> Color { Color(css: def.priority.color(forLevel: level)) }
}

extension Color {
    /// `#rrggbb` or `rgba(r, g, b, a)` — the two forms the tokens use.
    init(css: String) {
        let s = css.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#"), let v = UInt64(s.dropFirst(), radix: 16), s.count == 7 {
            self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
        } else if s.hasPrefix("rgba(") {
            let n = s.dropFirst(5).dropLast().split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if n.count == 4 { self.init(red: n[0] / 255, green: n[1] / 255, blue: n[2] / 255, opacity: n[3]); return }
            self = .clear
        } else {
            self = .primary
        }
    }
}
