import ParkerCore
import SwiftUI

struct NotesListView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @State private var opened: String?

    var body: some View {
        let theme = Theme.current(scheme)
        NavigationStack {
            List {
                ForEach(workspace.notes, id: \.name) { note in
                    NavigationLink(value: note.name) {
                        HStack {
                            Text(note.name.replacingOccurrences(of: ".md", with: "")).lineLimit(1)
                            Spacer()
                            Text(note.modified, style: .relative).font(.subheadline).foregroundStyle(theme.muted)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Notes")
            .navigationDestination(for: String.self) { name in NoteView(name: name) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { if let n = workspace.create() { opened = n } } label: { Image(systemName: "plus") }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Menu { Button("Change folder…", role: .destructive) { workspace.forget() } } label: { Image(systemName: "gearshape") }
                }
            }
            .navigationDestination(item: $opened) { name in NoteView(name: name) }
            .refreshable { workspace.refresh() }
            .safeAreaInset(edge: .bottom) {
                Text("\(workspace.notes.count) notes · \(workspace.folderLabel)")
                    .font(.footnote).foregroundStyle(theme.muted).padding(.vertical, 6).frame(maxWidth: .infinity)
            }
        }
    }
}
