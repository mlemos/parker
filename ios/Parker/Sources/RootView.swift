import SwiftUI

struct RootView: View {
    @Environment(Workspace.self) private var workspace
    @State private var tab = Tab.notes

    enum Tab { case search, notes, tasks }

    var body: some View {
        Group {
            if workspace.folder == nil {
                OnboardingView()
            } else {
                TabView(selection: $tab) {
                    SearchView().tabItem { Label("Search", systemImage: "magnifyingglass") }.tag(Tab.search)
                    NotesListView().tabItem { Label("Notes", systemImage: "doc.text") }.tag(Tab.notes)
                    TasksView().tabItem { Label("Tasks", systemImage: "checkmark.square") }.tag(Tab.tasks)
                }
            }
        }
        // A file handed over by the OS — a tap in Files, "Open in Parker" from
        // a share sheet. It opens on the Notes tab, which takes the request.
        .onOpenURL { url in
            guard url.isFileURL, let ref = workspace.open(fileAt: url) else { return }
            workspace.openRequest = ref
            tab = .notes
        }
    }
}
