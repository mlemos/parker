import Foundation
import Testing
@testable import ParkerCore

@Suite("task scan") struct TaskScanTests {
    static let launch = TextDocument("""
    # Launch checklist

    Ship v0.1 by **Friday**. Remaining:

    /DOING!! Write the release notes
      /DONE Draft the highlights
      /TODO! Link the changelog
      - keep it under ten lines
    /ATTN Ask Ana about the icon
      - she sent two options, pick one

      - and a note after a blank
    /WAIT App review
    /TODO!!! Record the demo video
    /DONE Set up TestFlight
    """)

    @Test("finds every tagged line with its text, depth and details")
    func scan() {
        let items = Todo.scan(note: "Launch checklist.md", Self.launch)
        #expect(items.map(\.text) == [
            "Write the release notes", "Draft the highlights", "Link the changelog",
            "Ask Ana about the icon", "App review", "Record the demo video", "Set up TestFlight",
        ])
        #expect(items.map(\.state) == [.doing, .done, .todo, .attn, .wait, .todo, .done])
        #expect(items.map(\.priority) == [2, 0, 1, 0, 0, 3, 0])
        #expect(items.map(\.line) == [5, 6, 7, 9, 13, 14, 15])
        #expect(items[0].details == ["- keep it under ten lines"])
        #expect(items[1].parentLine == 5 && items[2].parentLine == 5)
        #expect(items[3].details == ["- she sent two options, pick one", "- and a note after a blank"])
        #expect(items[4].parentLine == nil && items[4].details.isEmpty)
    }

    @Test("groups by state in the rotation order, skipping empty states, priority first within a state")
    func byState() {
        let groups = Todo.groupByState(Todo.scan(note: "n", Self.launch))
        #expect(groups.map(\.state) == [.todo, .doing, .wait, .attn, .done])
        // !!! before !, even though the document has them the other way round
        #expect(groups[0].items.map(\.text) == ["Record the demo video", "Link the changelog"])
    }

    @Test("within one priority the document order holds, and priority never reorders the by-note scan")
    func stableOrder() {
        let doc = TextDocument("/TODO! a\n/TODO b\n/TODO! c\n/TODO!!! d\n/TODO e")
        let items = Todo.scan(note: "n", doc)
        #expect(items.map(\.text) == ["a", "b", "c", "d", "e"])          // by note: as written
        let todo = Todo.groupByState(items)[0].items.map(\.text)
        #expect(todo == ["d", "a", "c", "b", "e"])                        // by state: !!!, then the !s in order, then the rest
    }

    @Test("a nested task's path is note › parent")
    func path() {
        let items = Todo.scan(note: "Launch checklist.md", Self.launch)
        #expect(Todo.path(of: items[2], in: items) == ["Launch checklist.md", "Write the release notes"])
        #expect(Todo.path(of: items[5], in: items) == ["Launch checklist.md"])
    }

    @Test("an alias is normalised and a tag with no text is an empty task")
    func aliasAndEmpty() {
        let items = Todo.scan(note: "n", TextDocument("/WIP\n/BLOCKED   spaced"))
        #expect(items.map(\.state) == [.doing, .wait])
        #expect(items.map(\.text) == ["", "  spaced"])
    }

    @Test("appends after the last to-do and its nested lines")
    func appendAfterLast() {
        let doc = TextDocument("intro\n/TODO a\n  - detail\n\n  - late detail\nprose after")
        let (change, line) = Todo.appendTask("b", to: doc)
        #expect(change == Change(from: doc.line(5).to, insert: "\n/TODO b"))
        #expect(line == 6)
    }

    @Test("keeps a nested last to-do's indent, and goes to the end of a note without to-dos")
    func indentAndNone() {
        let nested = TextDocument("/TODO a\n  /TODO b")
        #expect(Todo.appendTask("c", to: nested).change == Change(from: nested.length, insert: "\n  /TODO c"))
        let none = TextDocument("just prose\nmore")
        #expect(Todo.appendTask("x", to: none) == (Change(from: none.length, insert: "\n/TODO x"), 3))
    }

    @Test("respects a trailing newline and an empty note")
    func trailingAndEmpty() {
        let trailing = TextDocument("/TODO a\n")
        #expect(Todo.appendTask("b", to: trailing) == (Change(from: 7, insert: "\n/TODO b"), 2))
        let empty = TextDocument("")
        #expect(Todo.appendTask("first", to: empty) == (Change(from: 0, insert: "/TODO first\n"), 1))
    }
}
