// The prefix rule, against the SAME fixtures as the Mac's suite
// (shared/fixtures/hanging-indent.json, read by src/lib/hanging-indent.test.ts).

import Foundation
import Testing
@testable import ParkerCore

private struct HangingFixtures: Decodable {
    struct Case: Decodable { let line: String; let cols: Int?; let box: Bool }
    let cases: [Case]
    static let shared: HangingFixtures = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("shared/fixtures/hanging-indent.json")
        return try! JSONDecoder().decode(HangingFixtures.self, from: Data(contentsOf: url))
    }()
}

@Suite("hanging indent") struct HangingIndentTests {
    @Test("hangs the same lines under the same column as the Mac", arguments: HangingFixtures.shared.cases.indices)
    func sharedCases(i: Int) {
        let c = HangingFixtures.shared.cases[i]
        let got = HangingIndent.prefix(of: c.line)
        if let cols = c.cols {
            #expect(got == HangingIndent.Prefix(cols: cols, box: c.box), Comment(rawValue: c.line.debugDescription))
        } else {
            #expect(got == nil, Comment(rawValue: c.line.debugDescription))
        }
    }
}
