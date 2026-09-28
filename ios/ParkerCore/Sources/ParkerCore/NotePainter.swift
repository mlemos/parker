// A note's colours, as the Mac's editor paints them — computed by the Mac's
// own code. shared/parker-paint.js is src/lib/paint.ts bundled: the Mac's
// markdown parser and the rules of its stylesheet, as one script. This runs
// it in JavaScriptCore, so a note is parsed and coloured by one set of rules
// on both, and a change on the Mac reaches the phone by re-bundling, not by
// porting. (On Android this is a JavaScript engine too; nothing below is
// Apple's but the engine.)
//
// What comes back, per line: its tone (a to-do line's state, or the state of
// the to-do it sits under), where the to-do's tag is (drawn as a box), and the
// rest of the line in runs — each with a colour role and its face. Offsets
// are UTF-16, in the line as the file has it.

import Foundation
import JavaScriptCore

public struct LinePaint: Decodable, Equatable, Sendable {
    public let tone: String
    public let tag: [Int]?
    public let runs: [PaintRun]

    /// The state a to-do line wears ("todo-doing" → .doing), or nil.
    public var lineState: TodoState? { tone.hasPrefix("todo-") ? TodoState(rawValue: String(tone.dropFirst(5)).uppercased()) : nil }
    /// The state of the to-do this line sits under ("child-done" → .done), or nil.
    public var ownerState: TodoState? { tone.hasPrefix("child-") ? TodoState(rawValue: String(tone.dropFirst(6)).uppercased()) : nil }
}

public struct PaintRun: Decodable, Equatable, Sendable {
    public let from: Int
    public let to: Int
    public let role: Role
    public let bold: Bool
    public let italic: Bool
    public let underline: Bool
    public let wash: Wash?

    public enum Role: String, Decodable, Sendable {
        case plain, comment, string, label, heading, quote, fence, list
        case italic, bold, boldItalic, code, link, url, highlight, strike
        /// The line's state colour, or its to-do's, dimmed, under one.
        case line
    }

    public enum Wash: String, Decodable, Sendable { case code, highlight }

    /// The marks keep their own colours under a to-do — dimmed by the marks'
    /// dial, not the line's.
    public var isMark: Bool {
        switch role {
        case .italic, .bold, .boldItalic, .code, .link, .url, .highlight, .strike: return true
        default: return false
        }
    }

    enum CodingKeys: String, CodingKey { case from, to, role, bold, italic, underline, wash }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decode(Int.self, forKey: .from)
        to = try c.decode(Int.self, forKey: .to)
        role = (try? c.decode(Role.self, forKey: .role)) ?? .plain
        bold = try c.decodeIfPresent(Bool.self, forKey: .bold) ?? false
        italic = try c.decodeIfPresent(Bool.self, forKey: .italic) ?? false
        underline = try c.decodeIfPresent(Bool.self, forKey: .underline) ?? false
        wash = try c.decodeIfPresent(Wash.self, forKey: .wash)
    }
}

/// Not thread-safe (a JSContext isn't): one per thread, the editor's on main.
public final class NotePainter {
    private let context: JSContext
    private let paintFn: JSValue

    public enum Failure: Error { case script(String), noPainter }

    /// `script` is shared/parker-paint.js.
    public init(script: String) throws {
        guard let context = JSContext() else { throw Failure.noPainter }
        var error: String?
        context.exceptionHandler = { _, e in error = e?.toString() }
        context.evaluateScript(script)
        if let error { throw Failure.script(error) }
        guard let fn = context.objectForKeyedSubscript("ParkerPaint")?.objectForKeyedSubscript("paint"), fn.isObject else {
            throw Failure.noPainter
        }
        self.context = context
        paintFn = fn
    }

    /// The paint of every line of `text` (split on "\n"); empty if the script
    /// fails, so a note is shown uncoloured rather than not at all.
    public func paint(_ text: String) -> [LinePaint] {
        guard let json = paintFn.call(withArguments: [text])?.toString(), let data = json.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([LinePaint].self, from: data)) ?? []
    }
}
