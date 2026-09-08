import Foundation
import Testing
@testable import ParkerCore

@Suite("task scan") struct TaskScanTests {
    static let launch = TextDocument("""
    # Launch checklist

    Ship v0.1 by **Friday**. Remaining:

    /DOING Write the release notes
      /DONE Draft the highlights
      /TODO Link the changelog
      - keep it under ten lines
    /ATTN Ask Ana about the icon
      - she sent two options, pick one

      - and a note after a blank
    /WAIT App review
    /TODO Record the demo video
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
        #expect(items.map(\.line) == [5, 6, 7, 9, 13, 14, 15])
        #expect(items[0].details == ["- keep it under ten lines"])
        #expect(items[1].parentLine == 5 && items[2].parentLine == 5)
        #expect(items[3].details == ["- she sent two options, pick one", "- and a note after a blank"])
        #expect(items[4].parentLine == nil && items[4].details.isEmpty)
    }

    @Test("groups by state in the rotation order, skipping empty states")
    func byState() {
        let groups = Todo.groupByState(Todo.scan(note: "n", Self.launch))
        #expect(groups.map(\.state) == [.todo, .doing, .wait, .attn, .done])
        #expect(groups[0].items.map(\.text) == ["Link the changelog", "Record the demo video"])
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
