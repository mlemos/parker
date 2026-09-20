// A file from outside the notes folder — opened from Files, or picked with
// "Open file…" — that Parker edits where it is. The Mac's rule (src-tauri/
// src/external.rs): the file is never renamed, trashed, searched or backed
// up, but it is read and written in place, and it says so in a band.
//
// iOS hands such a file over security-scoped: the app may read it only while
// it says it is, and only again later through a bookmark it kept. Both are
// this type's business.

import Foundation
import ParkerCore

struct ExternalFile: Identifiable, Hashable {
    let url: URL
    /// The way back to the file across launches.
    let bookmark: Data
    var id: String { url.path }

    var displayName: String { url.lastPathComponent }
    /// Where it lives, as Files would say it: the last folder before the name.
    var folderLabel: String {
        let dir = url.deletingLastPathComponent()
        return (try? dir.resourceValues(forKeys: [.localizedNameKey]).localizedName) ?? dir.lastPathComponent
    }
}

/// What the editor shows: a note in the folder, by name, or a file from
/// outside it.
enum NoteRef: Hashable {
    case note(String)
    case external(ExternalFile)

    var title: String {
        switch self {
        case .note(let name): return NotesFolder.displayName(name).replacingOccurrences(of: ".md", with: "")
        case .external(let f): return f.displayName.replacingOccurrences(of: ".md", with: "")
        }
    }
}
