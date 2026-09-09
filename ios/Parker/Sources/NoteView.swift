// The note: plain text in Geist Mono, saved on every change (debounced), read
// back when the folder watcher says it changed underneath. A first cut: the
// editor is the system text view; the to-do line styling comes next.

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
        TextEditor(text: $text)
            .font(.system(size: 15, design: .monospaced))
            .lineSpacing(6)
            .scrollContentBackground(.hidden)
            .background(theme.editorBg)
            .foregroundStyle(theme.editorFg)
            .padding(.horizontal, 8)
            .navigationTitle(name.replacingOccurrences(of: ".md", with: ""))
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { if !loaded { text = workspace.read(name); loaded = true } }
            .onChange(of: text) { _, new in
                guard loaded else { return }
                saveTask?.cancel()
                saveTask = Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(500))
                    if !Task.isCancelled { workspace.write(name, new) }
                }
            }
            .onDisappear { saveTask?.cancel(); if loaded { workspace.write(name, text) } }
    }
}
