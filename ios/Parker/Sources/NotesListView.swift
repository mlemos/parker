import ParkerCore
import SwiftUI
import UniformTypeIdentifiers

struct NotesListView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @State private var opened: NoteRef?
    @State private var picking = false

    /// What "Open file…" offers: Markdown and plain text, as the Mac's panel.
    static let openable: [UTType] = [UTType(importedAs: "net.daringfireball.markdown"), .plainText, .text]

    var body: some View {
        let theme = Theme.current(scheme)
        NavigationStack {
            List {
                // Files from outside the folder, edited where they are. Above
                // the notes, since they are the odd ones out; swipe to let go.
                if !workspace.externals.isEmpty {
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
                ForEach(workspace.notes, id: \.name) { note in
                    NavigationLink(value: note.name) {
                        HStack {
                            NoteTitle(name: note.name, theme: theme)
                            Spacer()
                            Text(note.modified, style: .relative).font(.subheadline).foregroundStyle(theme.muted)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Notes")
            .navigationDestination(for: String.self) { name in NoteView(name: name) }
            .navigationDestination(for: NoteRef.self) { ref in NoteView(ref: ref) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { if let n = workspace.create() { opened = .note(n) } } label: { Image(systemName: "plus") }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button { picking = true } label: { Label("Open file…", systemImage: "folder") }
                        Button("Change folder…", role: .destructive) { workspace.forget() }
                    } label: { Image(systemName: "gearshape") }
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
                Text("\(workspace.notes.count) notes · \(workspace.folderLabel)")
                    .font(.footnote).foregroundStyle(theme.muted).padding(.vertical, 6).frame(maxWidth: .infinity)
            }
        }
    }
}
