// The note painter the phone runs (shared/parker-paint.js, the Mac's
// src/lib/paint.ts bundled), against shared/fixtures/note-paint.json — the
// paint the Mac's test checked against its real editor, character by character.

import Foundation
import Testing
@testable import ParkerCore

private let sharedDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("shared")

private struct PaintFixture: Decodable {
    struct Case: Decodable { let name: String; let note: String; let lines: [LinePaint] }
    let cases: [Case]
    static let shared: PaintFixture = try! JSONDecoder().decode(
        PaintFixture.self, from: Data(contentsOf: sharedDir.appendingPathComponent("fixtures/note-paint.json")))
}

private func painter() throws -> NotePainter {
    try NotePainter(script: String(contentsOf: sharedDir.appendingPathComponent("parker-paint.js"), encoding: .utf8))
}

@Suite("note painter") struct NotePainterTests {
    @Test("paints every case as the Mac's editor does", arguments: PaintFixture.shared.cases.indices)
    func sharedCases(i: Int) throws {
        let c = PaintFixture.shared.cases[i]
        let got = try painter().paint(c.note)
        #expect(got.count == c.lines.count, Comment(rawValue: c.name))
        for (n, (a, b)) in zip(got, c.lines).enumerated() {
            #expect(a == b, Comment(rawValue: "\(c.name), line \(n + 1): \(c.note.components(separatedBy: "\n")[n].debugDescription)"))
        }
    }

    @Test("reads tones as states")
    func tones() throws {
        let lines = try painter().paint("/DOING x\n  under\n/TODO y\nplain")
        #expect(lines[0].lineState == .doing)
        #expect(lines[1].ownerState == .doing)
        #expect(lines[2].lineState == nil && lines[2].tag == [0, 5])
        #expect(lines[3].tone == "")
    }

    @Test("covers each line once, the tag aside")
    func coverage() throws {
        for c in PaintFixture.shared.cases {
            let text = c.note.components(separatedBy: "\n")
            for (n, line) in try painter().paint(c.note).enumerated() {
                var at = 0
                for r in line.runs {
                    if let tag = line.tag, at == tag[0] { at = tag[1] }
                    #expect(r.from == at, Comment(rawValue: "\(c.name) \(n + 1)"))
                    at = r.to
                }
                if let tag = line.tag, at == tag[0] { at = tag[1] }
                #expect(at == (text[n] as NSString).length, Comment(rawValue: "\(c.name) \(n + 1)"))
            }
        }
    }

    @Test("keeps up with typing in a long note")
    func speed() throws {
        let p = try painter()
        let note = Array(repeating: PaintFixture.shared.cases.map(\.note).joined(separator: "\n\n"), count: 20).joined(separator: "\n\n")
        _ = p.paint(note) // warm the engine up
        let start = Date()
        let lines = p.paint(note)
        let ms = Date().timeIntervalSince(start) * 1000
        print("painted \(lines.count) lines in \(Int(ms)) ms")
        #expect(lines.count == note.components(separatedBy: "\n").count)
        #expect(ms < 250)
    }
}
