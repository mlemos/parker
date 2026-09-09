import SwiftUI

@main
struct ParkerApp: App {
    @State private var workspace = Workspace()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(workspace)
        }
    }
}
