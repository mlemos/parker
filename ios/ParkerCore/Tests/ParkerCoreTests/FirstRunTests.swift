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

    @Test("the sentences")
    func sentences() {
        let found = FolderSummary(exists: true, notes: 42, sync: .icloud)
        #expect(FirstRunText.contents(found) == "42 notes")
        #expect(FirstRunText.contents(FolderSummary(exists: false, sync: .icloud)) == "Doesn't exist yet — created when you continue")
        #expect(FirstRunText.state(FolderSummary(exists: true, notes: 1, other: 2, sync: .icloud)) == "Exists, with 1 note and 2 other files Parker leaves alone.")
        #expect(FirstRunText.sync(found, driveOn: true) == "Syncs with iCloud Drive.")
        #expect(FirstRunText.sync(FolderSummary(exists: true, sync: .onThisPhone), driveOn: false) == "Stays on this iPhone — iCloud Drive is off.")
        #expect(FirstRunText.sync(FolderSummary(exists: true, sync: .dropbox), driveOn: true).contains("in Dropbox"))
        #expect(FirstRunText.mac(found, suggested: true, display: "").contains("finds this folder by itself"))
        #expect(FirstRunText.mac(FolderSummary(exists: true, sync: .googleDrive), suggested: false, display: "Google Drive › Notes")
                == "On the Mac, install Google Drive and choose this folder in Parker's welcome screen: Google Drive › Notes.")
        #expect(FirstRunText.git(FolderSummary(exists: true, git: true, gitRemote: "github.com/owner/repo", sync: .icloud)).text.contains("github.com/owner/repo"))
    }
}
