import ParkerCore
import SwiftUI

struct SearchView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @State private var query = ""

    var body: some View {
        let theme = Theme.current(scheme)
        let hits = workspace.search(query)
        NavigationStack {
            List {
                let named = hits.filter(\.inName), inBody = hits.filter { !$0.inName }
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
        }
    }

    private func row(_ hit: NoteHit, _ theme: Theme) -> some View {
        NavigationLink(value: hit.name) {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(hit.name.replacingOccurrences(of: ".md", with: "")).font(.headline).lineLimit(1)
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
