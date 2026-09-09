// The design contract shared with the Mac: shared/design-tokens.json, written
// by scripts/export-design-tokens.mjs from the TypeScript tables the Mac
// renders from. The phone paints note content from THIS, never from values of
// its own — that is what keeps a note looking like the same note on both.

import Foundation

public struct DesignTokens: Decodable, Sendable {
    public struct Theme: Decodable, Sendable {
        public let id: String
        public let label: String
        public let mode: Mode
        public let ui: UI
        public let syntax: Syntax
        public let todo: TodoColors
        /// Priority of an open to-do: the empty box's border. base = no bang,
        /// then `!` low, `!!` mid, `!!!` high — a traffic ramp with no grey.
        public let priority: PriorityColors

        public enum Mode: String, Decodable, Sendable { case light, dark }
    }

    public struct PriorityColors: Decodable, Sendable {
        public let base, low, mid, high: String

        public func color(forLevel level: Int) -> String {
            switch level {
            case 1: return low
            case 2: return mid
            case 3: return high
            default: return base
            }
        }
    }

    /// Chrome roles. Colors are CSS strings: `#rrggbb` or `rgba(r, g, b, a)`.
    public struct UI: Decodable, Sendable {
        public let editorBg, editorFg, currentLine, selection: String
        public let headerBg, fieldBg, tabbarBg, tabActiveBg, statusBg, popoverBg: String
        public let text, secondary, muted, border, accent, onAccent, danger: String
    }

    /// Editor content roles.
    public struct Syntax: Decodable, Sendable {
        public let plain, heading, bold, italic, list, inlineCode: String
        public let keyword, string, number, `func`, comment, punct, link, invalid: String
    }

    /// To-do state roles — named by the STATE, not the hue. TODO wears the body
    /// color and CANCEL wears `ui.muted`, so neither is listed here.
    public struct TodoColors: Decodable, Sendable {
        public let doing, pause, wait, attn, done, fail: String

        public func color(for state: TodoState) -> String? {
            switch state {
            case .doing: return doing
            case .pause: return pause
            case .wait: return wait
            case .attn: return attn
            case .done: return done
            case .fail: return fail
            case .todo, .cancel: return nil
            }
        }
    }

    public struct Todo: Decodable, Sendable {
        public let order: [String]
        public let aliases: [String: String]
        public let box: Box
        /// SVG markup per canonical state; empty for TODO, whose box is empty on purpose.
        public let glyphs: [String: String]

        public struct Box: Decodable, Sendable {
            public let size, border, radius, glyphFontSize, svgSize: String
        }
    }

    public let themes: [Theme]
    public let defaultThemeId: String
    public let todo: Todo

    public func theme(id: String) -> Theme? { themes.first { $0.id == id } }

    public static func load(from url: URL) throws -> DesignTokens {
        try JSONDecoder().decode(DesignTokens.self, from: Data(contentsOf: url))
    }
}
