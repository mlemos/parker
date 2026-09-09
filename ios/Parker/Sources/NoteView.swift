// The note, as the Mac shows it: to-do lines with their box, colours by
// state, nested lines in their owner's colour, headings and marks tinted —
// over the plain text of the file, saved on every change.

import ParkerCore
import SwiftUI

struct NoteView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    let name: String
    @State private var text = ""
    @State private var loaded = false
    @State private var saveTask: Task<Void, Never>?

    var body: some View {
        let theme = Theme.current(scheme)
        Group {
            if loaded {
                NoteTextView(text: $text, theme: theme) { new in
                    saveTask?.cancel()
                    saveTask = Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(500))
                        if !Task.isCancelled { workspace.write(name, new) }
                    }
                }
            } else {
                // Only a note still in the cloud takes long enough to be seen here.
                VStack(spacing: 10) {
                    ProgressView()
                    Text(workspace.isLocal(name) ? "Opening…" : "Downloading from iCloud…")
                        .font(.footnote).foregroundStyle(theme.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.editorBg)
        .ignoresSafeArea(.container, edges: .bottom)
        .navigationTitle(name.replacingOccurrences(of: ".md", with: ""))
        .navigationBarTitleDisplayMode(.inline)
        .task { if !loaded { text = await workspace.load(name); loaded = true } }
        .onChange(of: workspace.notes) { _, _ in
            // the folder changed underneath: take the disk's version when we have nothing unsaved
            if loaded, saveTask == nil || saveTask?.isCancelled == true {
                let disk = workspace.read(name)
                if disk != text { text = disk }
            }
        }
        .onDisappear { saveTask?.cancel(); if loaded { workspace.write(name, text) } }
    }
}
