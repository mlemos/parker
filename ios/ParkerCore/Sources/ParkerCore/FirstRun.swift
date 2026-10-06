// The iPhone's first run (Onda 5): what a folder holds, where it syncs, and
// the sentences the screens say about it — the sibling of the Mac's
// lib/first-run.ts, following the "Parker iPhone First Run" prototype of
// 24/09. Pure, so every sentence is tested; the SwiftUI screen only lays
// them out.

import Foundation

/// Which service keeps a folder in sync, from where iOS says it lives.
public enum SyncKind: Equatable {
    case icloud, dropbox, googleDrive, oneDrive, box, onThisPhone, unknown
    /// Another app's cloud — Dropbox, Google Drive, Box… — that iOS won't
    /// name. Today's File Provider apps all keep their folders under
    /// Library/CloudStorage/<a UUID>, and neither the folder above nor
    /// NSFileProviderManager tells another app whose it is (checked 05/10 on a
    /// real Dropbox: the root is named only by its UUID, and asking the
    /// manager is refused). It syncs; which service, only the user knows.
    case cloudService

    /// A picked folder's service, from its path: iCloud Drive lives under
    /// "Mobile Documents"; other clouds under Library/CloudStorage (or, in
    /// older apps, their own bundle ids); the app's own Documents is On My
    /// iPhone.
    public static func of(path: String) -> SyncKind {
        let p = path.lowercased()
        if p.contains("/mobile documents/") { return .icloud }
        if p.contains("com.getdropbox") || p.contains("/dropbox/") { return .dropbox }
        if p.contains("com.google.drive") || p.contains("/google drive/") { return .googleDrive }
        if p.contains("onedrive") { return .oneDrive }
        if p.contains("net.box") || p.contains("/box/") { return .box }
        if p.contains("/library/cloudstorage/") { return .cloudService }
        if p.contains("fileprovider.localstorage") || p.contains("/data/application/") { return .onThisPhone }
        return .unknown
    }

    public var label: String {
        switch self {
        case .icloud: return "iCloud Drive"
        case .dropbox: return "Dropbox"
        case .googleDrive: return "Google Drive"
        case .oneDrive: return "OneDrive"
        case .box: return "Box"
        case .onThisPhone: return "On My iPhone"
        case .cloudService, .unknown: return ""
        }
    }
}

/// A picked folder as the screens name it. In iCloud Drive the whole way
/// down — "iCloud Drive › Documents › Notes", as the Mac names it too — so
/// "choose this folder" says which one; elsewhere iOS gives nothing to name
/// the place by, and the folder's own name is all there is.
public enum FolderDisplay {
    public static func of(path: String, name: String) -> String {
        let marker = "/Mobile Documents/com~apple~CloudDocs"
        guard let r = path.range(of: marker) else { return name }
        var parts = path[r.upperBound...].split(separator: "/").map(String.init)
        if !parts.isEmpty { parts[parts.count - 1] = name }
        return (["iCloud Drive"] + parts).joined(separator: " › ")
    }
}

/// What the screens say about one folder.
public struct FolderSummary: Equatable {
    public var exists: Bool
    public var notes: Int
    public var other: Int
    public var git: Bool
    public var gitRemote: String?
    public var sync: SyncKind

    public init(exists: Bool, notes: Int = 0, other: Int = 0, git: Bool = false, gitRemote: String? = nil, sync: SyncKind) {
        self.exists = exists; self.notes = notes; self.other = other; self.git = git; self.gitRemote = gitRemote; self.sync = sync
    }

    /// Look at a folder: count notes (Markdown and text) and other visible
    /// files at any depth, and find its git remote.
    public static func of(_ url: URL, fileManager fm: FileManager = .default) -> FolderSummary {
        var isDir: ObjCBool = false
        let sync = SyncKind.of(path: url.path)
        guard fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else {
            return FolderSummary(exists: false, sync: sync)
        }
        var notes = 0, other = 0
        if let e = fm.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) {
            for case let f as URL in e where (try? f.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
                if isNoteFile(f.lastPathComponent) { notes += 1 } else { other += 1 }
            }
        }
        let config = url.appendingPathComponent(".git/config")
        let git = fm.fileExists(atPath: url.appendingPathComponent(".git").path)
        let remote = (try? String(contentsOf: config, encoding: .utf8)).flatMap(GitRemote.first(inConfig:)).map(GitRemote.short)
        return FolderSummary(exists: true, notes: notes, other: other, git: git, gitRemote: remote, sync: sync)
    }

    public static func isNoteFile(_ name: String) -> Bool {
        let n = name.lowercased()
        return [".md", ".markdown", ".mdown", ".mkd", ".txt"].contains { n.hasSuffix($0) }
    }
}

public enum GitRemote {
    /// The first remote's url in a .git/config.
    public static func first(inConfig text: String) -> String? {
        var inRemote = false
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("[") { inRemote = line.hasPrefix("[remote "); continue }
            if inRemote, line.hasPrefix("url") , let eq = line.firstIndex(of: "=") {
                let v = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
                if !v.isEmpty { return v }
            }
        }
        return nil
    }

    /// "git@github.com:owner/repo.git" → "github.com/owner/repo", as the Mac says it.
    public static func short(_ url: String) -> String {
        var u = url.trimmingCharacters(in: .whitespaces)
        if u.hasSuffix(".git") { u.removeLast(4) }
        if let r = u.range(of: "://") { u = String(u[r.upperBound...]) }
        if let at = u.lastIndex(of: "@") { u = String(u[u.index(after: at)...]) }
        if let colon = u.firstIndex(of: ":") { u.replaceSubrange(colon...colon, with: "/") }
        return u.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

/// Every word of the first run: shared/first-run-copy.json, the file the
/// Mac's screens read too, so the two apps say the same thing. A key ending in
/// @iphone is this app's version of the key without it; {name} is filled in.
/// The app sets `shared` at launch from its bundled copy of the file.
public struct FirstRunCopy: Sendable {
    public let strings: [String: String]

    public init(strings: [String: String]) { self.strings = strings }

    public init(data: Data) throws {
        struct File: Decodable { let strings: [String: String] }
        strings = try JSONDecoder().decode(File.self, from: data).strings
    }

    /// The iPhone's version of `key`, placeholders filled; the key itself if
    /// it is missing (the tests make sure none is).
    public func text(_ key: String, _ vars: [String: String] = [:]) -> String {
        var s = strings[key + "@iphone"] ?? strings[key] ?? key
        for (k, v) in vars { s = s.replacingOccurrences(of: "{\(k)}", with: v) }
        return s
    }

    public func has(_ key: String) -> Bool { strings[key + "@iphone"] != nil || strings[key] != nil }

    nonisolated(unsafe) public static var shared = FirstRunCopy(strings: [:])
}

private func t(_ key: String, _ vars: [String: String] = [:]) -> String { FirstRunCopy.shared.text(key, vars) }

/// How a line reads at a glance, as the Mac marks it: ✓, !, ? or –.
public enum Tone: String, Equatable, Sendable, Decodable { case ok, warn, unknown, none }

/// The screens' sentences, from FirstRunCopy. `suggested` is whether the
/// folder is Documents › Parker in iCloud Drive, the one folder both apps look
/// for by themselves. The Mac's src/lib/first-run-iphone.ts is their reference:
/// shared/fixtures/first-run-lines.json holds what they say in every situation.
public enum FirstRunText {
    static func count(_ n: Int, _ one: String) -> String { t(n == 1 ? "unit.\(one)" : "unit.\(one)s", ["n": String(n)]) }

    public static func contents(_ f: FolderSummary) -> String {
        if !f.exists { return t("line.contents.new") }
        if f.notes == 0 && f.other == 0 { return t("line.contents.empty") }
        if f.other == 0 { return t("line.contents.notes", ["notes": count(f.notes, "note")]) }
        return t("line.contents.notesOther", ["notes": count(f.notes, "note"), "other": count(f.other, "otherFile")])
    }

    public static func state(_ f: FolderSummary) -> String {
        if !f.exists { return t("line.state.new") }
        if f.notes == 0 && f.other == 0 { return t("line.state.empty") }
        if f.notes == 0 { return t("line.state.onlyOther", ["other": count(f.other, "file")]) }
        if f.other == 0 { return t("line.state.notes", ["notes": count(f.notes, "note")]) }
        return t("line.state.notesOther", ["notes": count(f.notes, "note"), "other": count(f.other, "otherFile")])
    }

    public static func stateTone(_ f: FolderSummary) -> Tone {
        !f.exists || (f.notes == 0 && f.other == 0) ? .none : f.notes > 0 ? .ok : .unknown
    }

    public static func sync(_ f: FolderSummary, driveOn: Bool) -> (tone: Tone, text: String) {
        switch f.sync {
        case .icloud: return driveOn ? (.ok, t("line.sync.icloud")) : (.warn, t("line.sync.icloudDriveOff"))
        case .onThisPhone: return (.warn, t(driveOn ? "line.sync.here" : "line.sync.hereDriveOff"))
        case .unknown: return (.unknown, t("line.sync.unknown"))
        case .cloudService: return (.ok, t("line.sync.anyService"))
        default: return (.ok, t("line.sync.service", ["service": f.sync.label]))
        }
    }

    public static func git(_ f: FolderSummary) -> (tone: Tone, text: String, note: String) {
        if f.git {
            return (.ok, f.gitRemote.map { t("line.git.remote", ["remote": $0]) } ?? t("line.git.noRemote"), t("line.git.note"))
        }
        return (.none, t(f.exists ? "line.git.none" : "line.git.new"), t("line.git.noneNote"))
    }

    /// For a folder in a cloud iOS won't name: the warning under Sync. Only
    /// the user knows which service it is, and they will need it on the Mac.
    public static func syncNote(_ f: FolderSummary) -> String? {
        f.sync == .cloudService ? t("line.sync.anyServiceNote") : nil
    }

    /// …and under On your Mac: Parker can't point the way there.
    public static func macNote(_ f: FolderSummary, display: String) -> String? {
        f.sync == .cloudService ? t("line.other.anyServiceNote", ["folder": display]) : nil
    }

    /// What to do on the Mac to open this same folder.
    public static func mac(_ f: FolderSummary, suggested: Bool, display: String) -> String {
        if suggested { return t("line.other.suggested") }
        switch f.sync {
        case .icloud: return t("line.other.icloud", ["folder": display])
        case .dropbox, .googleDrive, .oneDrive, .box: return t("line.other.service", ["service": f.sync.label, "folder": display])
        case .cloudService: return t("line.other.anyService", ["folder": display])
        case .onThisPhone: return t("line.other.here")
        case .unknown: return t("line.other.unknown")
        }
    }
}
