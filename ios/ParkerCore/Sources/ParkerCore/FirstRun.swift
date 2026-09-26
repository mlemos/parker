// The iPhone's first run (Onda 5): what a folder holds, where it syncs, and
// the sentences the screens say about it — the sibling of the Mac's
// lib/first-run.ts, following the "Parker iPhone First Run" prototype of
// 24/09. Pure, so every sentence is tested; the SwiftUI screen only lays
// them out.

import Foundation

/// Which service keeps a folder in sync, from where iOS says it lives.
public enum SyncKind: Equatable {
    case icloud, dropbox, googleDrive, oneDrive, box, onThisPhone, unknown

    /// A picked folder's service, from its path: iCloud Drive lives under
    /// "Mobile Documents"; the File Provider apps keep theirs under their own
    /// bundle ids; the app's own Documents is On My iPhone.
    public static func of(path: String) -> SyncKind {
        let p = path.lowercased()
        if p.contains("/mobile documents/") { return .icloud }
        if p.contains("com.getdropbox") || p.contains("/dropbox/") { return .dropbox }
        if p.contains("com.google.drive") || p.contains("/google drive/") { return .googleDrive }
        if p.contains("onedrive") { return .oneDrive }
        if p.contains("net.box") || p.contains("/box/") { return .box }
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
        case .unknown: return ""
        }
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

/// The screens' sentences. `suggested` is whether the folder is Documents ›
/// Parker in iCloud Drive, the one folder both apps look for by themselves.
public enum FirstRunText {
    static func plural(_ n: Int, _ w: String) -> String { "\(n) \(w)\(n == 1 ? "" : "s")" }

    public static func contents(_ f: FolderSummary) -> String {
        if !f.exists { return "Doesn't exist yet — created when you continue" }
        if f.notes == 0 && f.other == 0 { return "Empty" }
        return plural(f.notes, "note") + (f.other > 0 ? " · " + plural(f.other, "other file") : "")
    }

    public static func state(_ f: FolderSummary) -> String {
        if !f.exists { return "Doesn't exist yet — Parker creates it when you continue." }
        if f.notes == 0 && f.other == 0 { return "Exists and is empty — Parker adds a Welcome note." }
        if f.notes == 0 { return "Exists, with \(plural(f.other, "file")) but no notes yet." }
        return "Exists, with \(plural(f.notes, "note"))" + (f.other > 0 ? " and \(plural(f.other, "other file")) Parker leaves alone." : ".")
    }

    public static func sync(_ f: FolderSummary, driveOn: Bool) -> String {
        switch f.sync {
        case .icloud: return driveOn ? "Syncs with iCloud Drive." : "iCloud Drive is off on this iPhone."
        case .onThisPhone: return driveOn ? "Stays on this iPhone — it's in On My iPhone." : "Stays on this iPhone — iCloud Drive is off."
        case .unknown: return "Not in iCloud Drive. If it syncs some other way, see Other ways to sync."
        default: return "Not in iCloud Drive — this folder is in \(f.sync.label). See Other ways to sync."
        }
    }

    public static func git(_ f: FolderSummary) -> (text: String, note: String) {
        if f.git {
            return (f.gitRemote.map { "A git repository (remote: \($0))." } ?? "A git repository, with no remote.",
                    "Parker for iPhone just edits the notes; your Mac commits and pushes them.")
        }
        return ("Not a git repository.", "Optional — a Mac can make it one (Parker › Settings › Backup & Git).")
    }

    /// What to do on the Mac to open this same folder.
    public static func mac(_ f: FolderSummary, suggested: Bool, display: String) -> String {
        if suggested {
            return "Install Parker for Mac. If the Mac keeps Documents in iCloud, its welcome screen finds this folder by itself; if not, it shows you how to turn that on."
        }
        switch f.sync {
        case .icloud: return "On the Mac, choose this folder in Parker's welcome screen: \(display)."
        case .dropbox, .googleDrive, .oneDrive, .box:
            return "On the Mac, install \(f.sync.label) and choose this folder in Parker's welcome screen: \(display)."
        case .onThisPhone: return "Your Mac can't reach a folder that stays on this iPhone. Turn on iCloud Drive to keep your notes there."
        case .unknown: return "If this folder stays on this iPhone, your Mac can't open it."
        }
    }
}
