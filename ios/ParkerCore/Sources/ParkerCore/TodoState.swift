// The to-do state machine — a port of src/lib/todo-model.ts, kept in step by
// the shared fixtures in Tests/ParkerCoreTests/Fixtures/todo-model.json.

import Foundation

/// The eight canonical states, in the ⌘⏎ rotation order: the states you pass
/// through, then the outcomes.
public enum TodoState: String, CaseIterable, Codable, Sendable {
    case todo = "TODO"
    case doing = "DOING"
    case pause = "PAUSE"
    case wait = "WAIT"
    case attn = "ATTN"
    case done = "DONE"
    case fail = "FAIL"
    case cancel = "CANCEL"

    /// The ⌘⏎ rotation order. `allCases` is declared in that order on purpose.
    public static let order: [TodoState] = TodoState.allCases

    /// The states that mean "still on your plate" — a plain tap completes
    /// them, and anything else is an outcome a plain tap reopens.
    public static let open: Set<TodoState> = [.todo, .doing, .pause, .wait, .attn]

    public var isOpen: Bool { TodoState.open.contains(self) }
}

public enum Todo {
    /// Alias → canonical state. Canonical tags are the short form; the longer
    /// spellings people reach for normalize on any interaction.
    ///
    ///   /PAUSE  you stopped it — nothing external is missing, you chose to park it
    ///   /WAIT   someone else has it — you cannot move it even if you wanted to
    ///   /ATTN   it needs *you* — the next move is yours and you haven't made it
    public static let aliases: [String: TodoState] = [
        "WIP": .doing,
        "PAUSED": .pause,
        "HOLD": .pause,
        "WAITING": .wait,
        "BLOCKED": .wait,
        "MISSED": .fail,
        "DISMISSED": .cancel,
    ]

    /// Canonical state for a tag word (state or alias); nil for anything else.
    public static func norm(_ word: String) -> TodoState? {
        TodoState(rawValue: word) ?? aliases[word]
    }

    /// The slash tag at the start of a line, after optional indent, with an
    /// optional priority: one to three bangs glued to the word — `/TODO!!`.
    /// Four bangs, or a space before them, is not a priority: `/TODO !!` is a
    /// to-do whose text is "!!".
    public struct Tag: Equatable, Sendable {
        /// Leading whitespace, as written (the regex's `\s*`).
        public let indent: String
        /// The word after the slash, as written — `WIP`, not `DOING`.
        public let word: String
        /// The canonical state.
        public let state: TodoState
        /// The bangs, as written: "", "!", "!!" or "!!!".
        public let bangs: String
        /// UTF-16 length of the whole match: indent + "/" + word + bangs.
        public let length: Int

        /// The priority: 0 (none) to 3.
        public var priority: Int { bangs.utf16.count }
    }

    private static let lineTag = try! NSRegularExpression(
        pattern: #"^(\s*)/(TODO|DOING|WIP|PAUSED|PAUSE|HOLD|WAITING|WAIT|BLOCKED|ATTN|DONE|FAIL|MISSED|CANCEL|DISMISSED)(!{1,3})?(?=\s|$)"#
    )

    /// LINE_TAG: the tag on a line, or nil. Only at the start of the line, and
    /// only the exact word — `/WAITER` and `/TODOS` are not tags.
    public static func tag(of line: String) -> Tag? {
        let ns = line as NSString
        guard let m = lineTag.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else {
            return nil
        }
        let indent = ns.substring(with: m.range(at: 1))
        let word = ns.substring(with: m.range(at: 2))
        let bangs = m.range(at: 3).location == NSNotFound ? "" : ns.substring(with: m.range(at: 3))
        guard let state = norm(word) else { return nil }
        return Tag(indent: indent, word: word, state: state, bangs: bangs, length: m.range.length)
    }

    /// The state a tap on the box moves to: a plain tap completes or reopens;
    /// the "alternate" gesture (⌥-click on the Mac, long-press on the phone)
    /// cycles the paused/waiting/attention/fail/cancel states.
    public static func nextOnClick(_ cur: TodoState, alt: Bool) -> TodoState {
        if !alt { return cur.isOpen ? .done : .todo }
        switch cur {
        case .todo: return .doing
        case .doing: return .pause
        case .pause: return .wait
        case .wait: return .attn
        case .attn: return .fail
        case .fail: return .cancel
        case .cancel: return .todo
        case .done: return .attn // DONE → needs another look
        }
    }

    /// The next state in the ⌘⏎ rotation; nil means "remove the tag".
    public static func nextInRotation(_ cur: TodoState) -> TodoState? {
        let i = TodoState.order.firstIndex(of: cur)!
        return i + 1 < TodoState.order.count ? TodoState.order[i + 1] : nil
    }
}
