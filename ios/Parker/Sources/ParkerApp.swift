import ParkerCore
import SwiftUI

@main
struct ParkerApp: App {
    @State private var workspace = Workspace()

    init() {
        // The first run's words, from the file the Mac reads too.
        if let url = Bundle.main.url(forResource: "first-run-copy", withExtension: "json"),
           let data = try? Data(contentsOf: url), let copy = try? FirstRunCopy(data: data) {
            FirstRunCopy.shared = copy
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(workspace)
        }
    }
}
