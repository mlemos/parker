// The to-do grammar, tested against the SAME fixtures as the TypeScript suite
// (shared/fixtures/todo-model.json, read by src/lib/todo-model.test.ts too).
// If the two ports ever disagree, one of these fails on one side — that is
// the point.

import Foundation
import Testing
@testable import ParkerCore

// ---- Fixtures ----------------------------------------------------------------

struct Fixtures: Decodable {
    struct Click: Decodable {
        let completes: [String]
        let reopens: [String]
        let altCycle: [String]
        let altFromDone: String
    }
    struct CursorCase: Decodable { let name: String; let text: String; let head: Int; let want: Int }
    struct OwnerCase: Decodable {
        let name: String
        let lines: [String]
        let from: Int?
        let to: Int?
        let want: [String?]
    }
    struct Priority: Decodable {
        struct TagCase: Decodable { let line: String; let word: String; let level: Int }
        struct Rotate: Decodable { let line: String; let after: String }
        struct ClickCase: Decodable { let line: String; let alt: Bool; let after: String }
        struct StepCase: Decodable { let name: String; let doc: String; let from: Int; let to: Int; let delta: Int; let after: String }
        let tags: [TagCase]
        let notTags: [String]
        let rotate: [Rotate]
        let click: [ClickCase]
        let step: [StepCase]
    }
    let order: [String]
    let aliases: [String: String]
    let notTags: [String]
    let click: Click
    let cursorCases: [CursorCase]
    let sweepDocs: [String: String]
    let ownerCases: [OwnerCase]
    let priority: Priority
    let enter: Enter

    struct Enter: Decodable {
        struct Case: Decodable { let line: String; let col: Int; let kind: String; let prefix: String?; let from: Int?; let to: Int? }
        let cases: [Case]
    }

    /// shared/fixtures/todo-model.json, found relative to this source file —
    /// SwiftPM resources cannot reach outside the target, and the fixtures are
    /// deliberately outside so the TypeScript suite reads the same file.
    static let shared: Fixtures = {
        let here = URL(fileURLWithPath: #filePath)
        let url = here
            .deletingLastPathComponent()   // → ParkerCoreTests/
            .deletingLastPathComponent()   // → Tests/
            .deletingLastPathComponent()   // → ParkerCore/
            .deletingLastPathComponent()   // → ios/
            .deletingLastPathComponent()   // → repo root
            .appendingPathComponent("shared/fixtures/todo-model.json")
        return try! JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
    }()
}

private func state(_ s: String) -> TodoState { TodoState(rawValue: s)! }

// ---- The state machine ---------------------------------------------------------

@Suite("norm") struct NormTests {
    @Test("folds every alias onto its canonical state")
    func aliases() {
        for (alias, canonical) in Fixtures.shared.aliases {
            #expect(Todo.norm(alias) == state(canonical), "\(alias)")
        }
    }

    @Test("leaves canonical states untouched, in the fixture's order")
    func canonical() {
        #expect(TodoState.order.map(\.rawValue) == Fixtures.shared.order)
        for st in TodoState.order { #expect(Todo.norm(st.rawValue) == st) }
    }
}

@Suite("LINE_TAG") struct LineTagTests {
    @Test("recognises every state and alias")
    func recognises() {
        let words = Fixtures.shared.order + Fixtures.shared.aliases.keys
        for w in words {
            let tag = Todo.tag(of: "/\(w) something")
            #expect(tag?.word == w, "/\(w)")
            #expect(tag?.length == w.utf16.count + 1)
        }
    }

    @Test("does not match words that merely start like a tag, or a tag mid-line")
    func rejects() {
        for line in Fixtures.shared.notTags { #expect(Todo.tag(of: line) == nil, Comment(rawValue: line)) }
    }

    @Test("keeps the indent and matches at end of line")
    func indentAndEOL() {
        let t = Todo.tag(of: "  /WIP")
        #expect(t?.indent == "  ")
        #expect(t?.state == .doing)
        #expect(t?.length == 6)
    }
}

@Suite("rotation") struct RotationTests {
    @Test("walks the whole order once and then clears the tag")
    func walk() {
        var walk: [TodoState] = []
        var cur: TodoState? = TodoState.order[0]
        while let s = cur { walk.append(s); cur = Todo.nextInRotation(s) }
        #expect(walk == TodoState.order)
    }
}

@Suite("clicking a tag") struct ClickTests {
    @Test("completes any open state")
    func completes() {
        for s in Fixtures.shared.click.completes { #expect(Todo.nextOnClick(state(s), alt: false) == .done, Comment(rawValue: s)) }
    }

    @Test("reopens any closed state")
    func reopens() {
        for s in Fixtures.shared.click.reopens { #expect(Todo.nextOnClick(state(s), alt: false) == .todo, Comment(rawValue: s)) }
    }

    @Test("cycles the open states under alt and returns where it started")
    func altCycle() {
        var cycle: [TodoState] = []
        var cur: TodoState = .todo
        repeat {
            cycle.append(cur)
            cur = Todo.nextOnClick(cur, alt: true)
        } while cur != .todo && cycle.count <= TodoState.order.count + 1
        #expect(cycle.map(\.rawValue) == Fixtures.shared.click.altCycle)
    }

    @Test("sends a done item back into the cycle under alt")
    func altFromDone() {
        #expect(Todo.nextOnClick(.done, alt: true) == state(Fixtures.shared.click.altFromDone))
    }
}

// ---- Cursor placement --------------------------------------------------------------

@Suite("cursorAfterRotate") struct CursorTests {
    @Test("lands after the tag", arguments: Fixtures.shared.cursorCases.map { ($0.name, $0.text, $0.head, $0.want) })
    func landsAfterTag(name: String, text: String, head: Int, want: Int) {
        let doc = TextDocument(lines: [text])
        let changes = Todo.planRotate(doc, from: head, to: head)
        #expect(Todo.cursorAfterRotate(changes, head: head) == want, Comment(rawValue: name))
    }
}

// ---- Which lines a selection acts on ------------------------------------------------
// Brute-forced over every possible selection, exactly like the TS suite.

private func expectedLines(_ doc: TextDocument, _ from: Int, _ to: Int) -> [Int] {
    let start = doc.lineAt(from)
    var end = doc.lineAt(to)
    let multi = end.number > start.number
    if multi && to == end.from { end = doc.lineAt(to - 1) }
    var out: [Int] = []
    for n in start.number...end.number {
        if end.number > start.number && doc.line(n).text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
        out.append(n)
    }
    return out
}

@Suite("planRotate over every selection") struct SweepTests {
    @Test("touches exactly the selected lines", arguments: Fixtures.shared.sweepDocs.map { ($0.key, $0.value) })
    func sweep(name: String, text: String) {
        let doc = TextDocument(text)
        var wrong: [String] = []
        var checked = 0
        for from in 0...doc.length {
            for to in from...doc.length {
                checked += 1
                var seen = Set<Int>()
                var got: [Int] = []
                for c in Todo.planRotate(doc, from: from, to: to) {
                    let n = doc.lineAt(c.from).number
                    if seen.insert(n).inserted { got.append(n) }
                }
                let want = expectedLines(doc, from, to)
                if got != want { wrong.append("[\(from),\(to)] want \(want) got \(got)") }
            }
        }
        #expect(checked > 100)
        #expect(Array(wrong.prefix(10)) == [], Comment(rawValue: name))
    }

    @Test("tags untagged lines and leaves tagged ones alone in a mixed selection")
    func mixed() {
        let doc = TextDocument("/TODO a\nb\n  c")
        let changes = Todo.planRotate(doc, from: 0, to: doc.length)
        #expect(changes == [Change(from: 8, insert: "/TODO "), Change(from: 12, insert: "/TODO ")])
    }

    @Test("advances every tagged line and clears the last state")
    func advances() {
        let doc = TextDocument("/TODO a\n/CANCEL b\n/WIP c")
        let changes = Todo.planRotate(doc, from: 0, to: doc.length)
        #expect(changes == [
            Change(from: 0, to: 5, insert: "/DOING"),
            Change(from: 8, to: 16),                 // /CANCEL + the space: tag removed
            Change(from: 18, to: 22, insert: "/PAUSE"), // WIP normalises to DOING, then steps
        ])
    }
}

// ---- Which to-do owns a line --------------------------------------------------------

@Suite("ownersForRange") struct OwnerTests {
    @Test("owner per line", arguments: Fixtures.shared.ownerCases.map { ($0.name, $0.lines, $0.from, $0.to, $0.want) })
    func owners(name: String, lines: [String], from: Int?, to: Int?, want: [String?]) {
        let doc = TextDocument(lines: lines)
        let got = Todo.ownersForRange(doc, fromLine: from ?? 1, toLine: to ?? doc.lineCount)
        #expect(got.map { $0?.rawValue } == want, Comment(rawValue: name))
    }
}

// ---- The document model -------------------------------------------------------------

@Suite("TextDocument") struct DocTests {
    @Test("addresses lines by UTF-16 offset like CodeMirror and UIKit")
    func offsets() {
        let doc = TextDocument("ab\n\ncdé\n")
        #expect(doc.lineCount == 4)
        #expect(doc.length == 8)
        #expect(doc.line(1) == DocLine(number: 1, from: 0, to: 2, text: "ab"))
        #expect(doc.line(2) == DocLine(number: 2, from: 3, to: 3, text: ""))
        #expect(doc.lineAt(2).number == 1)   // on the newline → still line 1
        #expect(doc.lineAt(3).number == 2)
        #expect(doc.lineAt(8).number == 4)   // the empty last line
        #expect(doc.line(3).to == 7)
    }

    @Test("counts an emoji as two UTF-16 units, as the editors do")
    func surrogates() {
        let doc = TextDocument("🙂x\ny")
        #expect(doc.line(1).to == 3)
        #expect(doc.line(2).from == 4)
        #expect(Todo.planRotate(doc, from: 4, to: 4) == [Change(from: 4, insert: "/TODO ")])
    }
}

// ---- Priority ------------------------------------------------------------------------
// Bangs glued to the tag are part of it: recognised, kept, and carried along
// when the state rotates or is tapped. Same fixtures as the TypeScript suite.

/// Apply changes (as planRotate/tagChange produce them) to a one-line doc.
private func applied(_ text: String, _ changes: [Change]) -> String {
    var u = Array(text.utf16)
    for c in changes.sorted(by: { $0.from > $1.from }) {
        let to = c.to ?? c.from
        u.replaceSubrange(c.from..<to, with: Array((c.insert ?? "").utf16))
    }
    return String(utf16CodeUnits: u, count: u.count)
}

@Suite("priority bangs") struct PriorityTests {
    @Test("are read off the tag, 0 to 3")
    func levels() {
        for c in Fixtures.shared.priority.tags {
            let t = Todo.tag(of: c.line)
            #expect(t?.word == c.word, Comment(rawValue: c.line))
            #expect(t?.priority == c.level, Comment(rawValue: c.line))
        }
    }

    @Test("do not make a tag out of four bangs, a bang before a letter, or a bang before the slash")
    func rejects() {
        for line in Fixtures.shared.priority.notTags { #expect(Todo.tag(of: line) == nil, Comment(rawValue: line)) }
    }

    @Test("travel with the state through the rotation")
    func rotate() {
        for c in Fixtures.shared.priority.rotate {
            let doc = TextDocument(lines: [c.line])
            #expect(applied(c.line, Todo.planRotate(doc, from: 0, to: 0)) == c.after, Comment(rawValue: c.line))
        }
    }

    @Test("step up and down, clamped, over the same lines as the rotation")
    func step() {
        for c in Fixtures.shared.priority.step {
            let doc = TextDocument(c.doc)
            #expect(applied(c.doc, Todo.planPriority(doc, from: c.from, to: c.to, delta: c.delta)) == c.after, Comment(rawValue: c.name))
        }
    }

    @Test("travel with the state through a tap")
    func tap() {
        for c in Fixtures.shared.priority.click {
            let doc = TextDocument(lines: [c.line])
            let tag = Todo.tag(of: c.line)!
            let change = Todo.tagChange(line: doc.line(1), tag: tag, next: Todo.nextOnClick(tag.state, alt: c.alt))
            #expect(applied(c.line, [change]) == c.after, Comment(rawValue: c.line))
        }
    }

    @Test("the whole tag, bangs included, is what the box covers")
    func length() {
        #expect(Todo.tag(of: "  /TODO!! x")?.length == 9)
        #expect(Todo.tag(of: "/WIP x")?.length == 4)
    }
}

@Suite("Enter continues a task or a list, and an empty one ends it") struct EnterTests {
    @Test("matches the shared cases")
    func cases() {
        for c in Fixtures.shared.enter.cases {
            let plan = Todo.planEnter(line: c.line, col: c.col)
            let label = Comment(rawValue: "\(c.line.debugDescription) @\(c.col)")
            switch c.kind {
            case "newline": #expect(plan == .newline, label)
            case "continue": #expect(plan == .continue(prefix: c.prefix!), label)
            case "exit": #expect(plan == .exit(from: c.from!, to: c.to!), label)
            default: Issue.record("unknown kind \(c.kind)")
            }
        }
    }
}
