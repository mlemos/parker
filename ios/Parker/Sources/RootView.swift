import SwiftUI

struct RootView: View {
    @Environment(Workspace.self) private var workspace

    var body: some View {
        if workspace.folder == nil {
            OnboardingView()
        } else {
            TabView {
                SearchView().tabItem { Label("Search", systemImage: "magnifyingglass") }
                NotesListView().tabItem { Label("Notes", systemImage: "doc.text") }
                TasksView().tabItem { Label("Tasks", systemImage: "checkmark.square") }
            }
        }
    }
}
