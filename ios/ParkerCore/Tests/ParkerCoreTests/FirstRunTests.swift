// The iPhone's first run: what a folder holds, who syncs it, and every
// sentence the screens say — the sibling of the Mac's lib/first-run.test.ts.

import Foundation
import Testing
@testable import ParkerCore

@Suite("first run")
struct FirstRunTests {
    @Test("a picked folder says who syncs it")
    func syncKind() {
        #expect(SyncKind.of(path: "/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Documents/Parker") == .icloud)
        #expect(SyncKind.of(path: "/private/var/mobile/Containers/Shared/AppGroup/X/File Provider Storage/com.getdropbox.Dropbox/Notes") == .dropbox)
        #expect(SyncKind.of(path: "/private/var/mobile/Containers/Shared/AppGroup/X/File Provider Storage/com.google.Drive/Notes") == .googleDrive)
        #expect(SyncKind.of(path: "/private/var/mobile/Containers/Shared/AppGroup/X/File Provider Storage/OneDrive/Notes") == .oneDrive)
        #expect(SyncKind.of(path: "/private/var/mobile/Containers/Data/Application/ABC/Documents/Parker") == .onThisPhone)
        #expect(SyncKind.of(path: "/somewhere/else") == .unknown)
        // The real thing, 05/10: a Dropbox folder picked on an iPhone. No
        // name in the path; under Library/CloudStorage, so a cloud service.
        #expect(SyncKind.of(path: "/private/var/mobile/Library/CloudStorage/46C389DD-A94F-40E0-B184-64D35DC64AEB/Parker (Dropbox)") == .cloudService)
    }

    @Test("names a folder in iCloud Drive the whole way down, and any other by its name")
    func folderDisplay() {
        let icloud = "/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Documents/Parker (Dev)"
        #expect(FolderDisplay.of(path: icloud, name: "Parker (Dev)") == "iCloud Drive › Documents › Parker (Dev)")
        #expect(FolderDisplay.of(path: "/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs", name: "iCloud Drive") == "iCloud Drive")
        #expect(FolderDisplay.of(path: "/private/var/mobile/Library/CloudStorage/46C389DD/Parker (Dropbox)", name: "Parker (Dropbox)") == "Parker (Dropbox)")
    }

    @Test("the git remote is read from .git/config and shortened")
    func gitRemote() {
        let config = """
        [core]
        \trepositoryformatversion = 0
        [remote "origin"]
        \turl = git@github.com:owner/repo.git
        \tfetch = +refs/heads/*:refs/remotes/origin/*
        """
        #expect(GitRemote.first(inConfig: config) == "git@github.com:owner/repo.git")
        #expect(GitRemote.short("git@github.com:owner/repo.git") == "github.com/owner/repo")
        #expect(GitRemote.short("https://github.com/owner/repo.git") == "github.com/owner/repo")
        #expect(GitRemote.first(inConfig: "[core]\n\tbare = false\n") == nil)
    }

    @Test("a folder is summarized: notes, other files, git")
    func summary() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("first-run-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: dir) }
        try fm.createDirectory(at: dir.appendingPathComponent("trips"), withIntermediateDirectories: true)
        try fm.createDirectory(at: dir.appendingPathComponent(".git"), withIntermediateDirectories: true)
        try "[remote \"origin\"]\n\turl = https://github.com/owner/repo.git\n"
            .write(to: dir.appendingPathComponent(".git/config"), atomically: true, encoding: .utf8)
        for f in ["a.md", "trips/b.md", "photo.png", ".DS_Store"] { try Data("x".utf8).write(to: dir.appendingPathComponent(f)) }
        let s = FolderSummary.of(dir)
        #expect(s.exists && s.git)
        #expect(s.notes == 2)
        #expect(s.other == 1)
        #expect(s.gitRemote == "github.com/owner/repo")
        #expect(!FolderSummary.of(dir.appendingPathComponent("nope")).exists)
    }

    // The sentences, against what the Mac's reference says for every
    // situation (shared/fixtures/first-run-lines.json), in the words of
    // shared/first-run-copy.json.
    @Test("says what the Mac's reference says, in every situation", arguments: LinesFixture.shared.cases.indices)
    func sentences(i: Int) {
        FirstRunCopy.shared = LinesFixture.copy
        let c = LinesFixture.shared.cases[i]
        let f = c.folder.summary
        let label = "\(c.folder) driveOn=\(c.driveOn) suggested=\(c.suggested)"
        #expect(FirstRunText.contents(f) == c.contents, Comment(rawValue: label))
        #expect(FirstRunText.state(f) == c.state, Comment(rawValue: label))
        let sync = FirstRunText.sync(f, driveOn: c.driveOn)
        #expect(sync.tone == c.sync.tone && sync.text == c.sync.text, Comment(rawValue: label))
        let git = FirstRunText.git(f)
        #expect(git.tone == c.git.tone && git.text == c.git.text && git.note == c.git.note, Comment(rawValue: label))
        #expect(FirstRunText.mac(f, suggested: c.suggested, display: c.display) == c.mac, Comment(rawValue: label))
    }

    @Test("every key the screens ask for is in the copy")
    func keys() throws {
        let copy = LinesFixture.copy
        for file in ["Parker/Sources/OnboardingView.swift", "ParkerCore/Sources/ParkerCore/FirstRun.swift"] {
            let src = try String(contentsOf: LinesFixture.ios.appendingPathComponent(file), encoding: .utf8)
            let keys = try NSRegularExpression(pattern: #"\bt\("([\w.]+)""#)
                .matches(in: src, range: NSRange(src.startIndex..., in: src))
                .map { String(src[Range($0.range(at: 1), in: src)!]) }
            #expect(!keys.isEmpty, Comment(rawValue: file))
            for k in keys { #expect(copy.has(k), Comment(rawValue: "\(file): \(k)")) }
        }
    }
}

struct LinesFixture: Decodable {
    struct Folder: Decodable, CustomStringConvertible {
        let exists: Bool, notes: Int, other: Int, git: Bool, gitRemote: String?, sync: String
        var summary: FolderSummary {
            let kind: SyncKind = ["icloud": .icloud, "dropbox": .dropbox, "googleDrive": .googleDrive, "oneDrive": .oneDrive,
                                  "box": .box, "cloudService": .cloudService, "onThisPhone": .onThisPhone][sync] ?? .unknown
            return FolderSummary(exists: exists, notes: notes, other: other, git: git, gitRemote: gitRemote, sync: kind)
        }
        var description: String { "\(sync) exists=\(exists) notes=\(notes) other=\(other) git=\(git) remote=\(gitRemote ?? "-")" }
    }
    struct Line: Decodable { let tone: Tone; let text: String }
    struct Git: Decodable { let tone: Tone; let text: String; let note: String }
    struct Case: Decodable {
        let folder: Folder, driveOn: Bool, suggested: Bool, display: String
        let contents: String, state: String, sync: Line, git: Git, mac: String
    }
    let cases: [Case]

    static let ios = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    static let sharedDir = ios.deletingLastPathComponent().appendingPathComponent("shared")
    static let shared: LinesFixture = try! JSONDecoder().decode(
        LinesFixture.self, from: Data(contentsOf: sharedDir.appendingPathComponent("fixtures/first-run-lines.json")))
    static let copy: FirstRunCopy = try! FirstRunCopy(data: Data(contentsOf: sharedDir.appendingPathComponent("first-run-copy.json")))
}
