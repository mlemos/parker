import ParkerCore
import SwiftUI

struct SearchView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @State private var query = ""

    var body: some View {
        let theme = Theme.current(scheme)
        // Reading `notes` here is what makes the list follow the folder: the
        // search itself lists files, which Observation cannot see.
        let _ = workspace.notes
        let hits = workspace.search(query)
        let folders = Folders.matching(folders: workspace.folders, notes: workspace.notes, scope: "", query: query)
        NavigationStack {
            List {
                let named = hits.filter(\.inName), inBody = hits.filter { !$0.inName }
                // Folders whose name matches: a way in, above the notes.
                if !folders.isEmpty {
                    Section("Folders") {
                        ForEach(folders, id: \.path) { f in
                            NavigationLink(value: FolderRef(path: f.path)) {
                                FolderRowView(row: f, theme: theme, parentLabel: Folders.parent(of: f.path))
                            }
                        }
                    }
                }
                if !named.isEmpty {
                    Section(query.isEmpty ? "All notes" : "Notes") { ForEach(named, id: \.name) { hit in row(hit, theme) } }
                }
                if !inBody.isEmpty {
                    Section("In notes · \(inBody.count)") { ForEach(inBody, id: \.name) { hit in row(hit, theme) } }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Search")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search notes")
            .navigationDestination(for: String.self) { name in NoteView(name: name) }
            .navigationDestination(for: FolderRef.self) { ref in NotesListView(scope: ref.path) }
        }
    }

    private func row(_ hit: NoteHit, _ theme: Theme) -> some View {
        NavigationLink(value: hit.name) {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    NoteTitle(name: hit.name, theme: theme, font: .headline)
                    Spacer()
                    Text(hit.modified, style: .relative).font(.caption).foregroundStyle(theme.muted)
                }
                if let s = hit.snippet {
                    Text(s).font(.system(size: 13, design: .monospaced)).foregroundStyle(theme.secondary).lineLimit(2)
                }
            }
        }
    }
}
