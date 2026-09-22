import ParkerCore
import SwiftUI
import UniformTypeIdentifiers

/// A folder to step into: pushed onto the Notes stack as a scoped list.
struct FolderRef: Hashable {
    /// With the trailing slash: "cos/desks/".
    let path: String
}

struct NotesListView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @State private var opened: NoteRef?
    @State private var picking = false
    /// "" at the root; "cos/desks/" inside a folder. The root is the tab; a
    /// folder is the same view pushed, titled after the folder.
    var scope: String = ""
    private var atRoot: Bool { scope.isEmpty }

    /// What "Open file…" offers: Markdown and plain text, as the Mac's panel.
    static let openable: [UTType] = [UTType(importedAs: "net.daringfireball.markdown"), .plainText, .text]

    var body: some View {
        if atRoot {
            NavigationStack { list }
        } else {
            list
        }
    }

    private var list: some View {
        let theme = Theme.current(scheme)
        let folders = Folders.children(folders: workspace.folders, notes: workspace.notes, scope: scope)
        // At the root the notes come from everywhere, newest first — the
        // folders above are the way in when you know where you are going.
        // Inside a folder, only its own notes: the subfolders stand for theirs.
        let notes = atRoot ? workspace.notes : Folders.own(notes: workspace.notes, scope: scope)
        let count = Folders.under(notes: workspace.notes, scope: scope).count
        return List {
                // Files from outside the folder, edited where they are. Above
                // the notes, since they are the odd ones out; swipe to let go.
                if atRoot && !workspace.externals.isEmpty {
                    Section("Files") {
                        ForEach(workspace.externals) { file in
                            NavigationLink(value: NoteRef.external(file)) {
                                HStack {
                                    (Text(file.folderLabel + " › ").foregroundStyle(theme.muted) + Text(file.displayName.replacingOccurrences(of: ".md", with: "")))
                                        .lineLimit(1)
                                    Spacer()
                                    Text("EXTERNAL").font(.caption2.weight(.bold)).foregroundStyle(Color(red: 0.925, green: 0.282, blue: 0.6))
                                }
                            }
                        }
                        .onDelete { offsets in
                            for i in offsets { workspace.close(external: workspace.externals[i]) }
                        }
                    }
                }
                if !folders.isEmpty {
                    Section(atRoot ? "Folders" : "In \(Folders.name(of: scope))") {
                        ForEach(folders, id: \.path) { f in
                            NavigationLink(value: FolderRef(path: f.path)) { FolderRowView(row: f, theme: theme) }
                        }
                    }
                }
                if !notes.isEmpty {
                    Section(atRoot ? (folders.isEmpty ? "" : "Recent") : "Notes") {
                        ForEach(notes, id: \.name) { note in
                            NavigationLink(value: note.name) {
                                HStack {
                                    // Inside a folder the name stands bare: the
                                    // title above already says where we are.
                                    NoteTitle(name: atRoot ? note.name : String(note.name.dropFirst(scope.count)), theme: theme)
                                    Spacer()
                                    Text(note.modified, style: .relative).font(.subheadline).foregroundStyle(theme.muted)
                                }
                            }
                        }
                    }
                }
                if folders.isEmpty && notes.isEmpty {
                    Section {
                        Text("Nothing here yet").foregroundStyle(theme.muted)
                    } footer: {
                        Text("Tap + to write the first note in this folder.")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(atRoot ? "Notes" : Folders.name(of: scope))
            .navigationDestination(for: String.self) { name in NoteView(name: name) }
            .navigationDestination(for: NoteRef.self) { ref in NoteView(ref: ref) }
            .navigationDestination(for: FolderRef.self) { ref in NotesListView(scope: ref.path) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // A new note lands where you are.
                    Button { if let n = workspace.create(in: scope) { opened = .note(n) } } label: { Image(systemName: "plus") }
                }
                if atRoot {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Button { picking = true } label: { Label("Open file…", systemImage: "folder") }
                            Button("Change folder…", role: .destructive) { workspace.forget() }
                        } label: { Image(systemName: "gearshape") }
                    }
                }
            }
            .navigationDestination(item: $opened) { ref in NoteView(ref: ref) }
            .fileImporter(isPresented: $picking, allowedContentTypes: Self.openable) { result in
                guard case .success(let url) = result, let ref = workspace.open(fileAt: url) else { return }
                opened = ref
            }
            // A tap in Files: the app was handed a URL, and this is where it opens.
            .onChange(of: workspace.openRequest) { _, req in
                if let req { opened = req; workspace.openRequest = nil }
            }
            .onAppear { if let req = workspace.openRequest { opened = req; workspace.openRequest = nil } }
            .refreshable { workspace.refresh() }
            .safeAreaInset(edge: .bottom) {
                Text(atRoot
                     ? "\(count) notes · \(workspace.folderLabel)"
                     : "\(count) \(count == 1 ? "note" : "notes") · \(String(scope.dropLast()))")
                    .font(.footnote).foregroundStyle(theme.muted).padding(.vertical, 6).frame(maxWidth: .infinity)
            }
    }
}

/// A folder in a list: icon, name, how many notes it holds, when the newest
/// changed. The chevron is the list's own.
struct FolderRowView: View {
    let row: FolderRow
    let theme: Theme
    /// Shown before the name when the folder sits deeper than the list's
    /// scope — a search finds cos/desks/ and desks/ alike.
    var parentLabel: String = ""

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "folder").foregroundStyle(theme.secondary)
            (Text(parentLabel).foregroundStyle(theme.muted) + Text(row.name)).lineLimit(1)
            Spacer()
            if row.count == 0 {
                Text("empty").font(.caption).foregroundStyle(theme.muted)
            } else {
                Text("\(row.count)").font(.subheadline).foregroundStyle(theme.muted)
            }
        }
    }
}
