// The note, as the Mac shows it: to-do lines with their box, colours by
// state, nested lines in their owner's colour, headings and marks tinted —
// over the plain text of the file, saved on every change.

import ParkerCore
import SwiftUI

struct NoteView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scenePhase) private var scenePhase
    let ref: NoteRef
    /// A line to land on when the note opens (1-based), from the Tasks tab.
    var focusLine: Int? = nil

    init(name: String, focusLine: Int? = nil) { self.ref = .note(name); self.focusLine = focusLine }
    init(ref: NoteRef, focusLine: Int? = nil) { self.ref = ref; self.focusLine = focusLine }
    @State private var text = ""
    @State private var loaded = false
    @State private var onDisk = ""
    @State private var saveTask: Task<Void, Never>?
    @State private var command: EditorCommand?
    @State private var pressed: PressedBox?

    var body: some View {
        let theme = Theme.current(scheme)
        VStack(spacing: 0) {
            // A file from outside the folder says so, the way the Mac does:
            // a pink band no other surface uses, the file's folder, and a
            // way to it in Files.
            if case .external(let file) = ref {
                ExternalBand(file: file)
            }
            if loaded {
                NoteTextView(text: $text, theme: theme, focusLine: focusLine, onChange: { new in
                    saveTask?.cancel()
                    saveTask = Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(500))
                        if !Task.isCancelled { workspace.write(ref, new); onDisk = new }
                    }
                }, onBoxLongPress: { index, box in
                    pressed = PressedBox(index: index, state: box.state, bangs: box.bangs)
                }, command: $command)
                .sheet(item: $pressed) { box in
                    BoxSheet(current: box.state, bangs: box.bangs, theme: theme) { state, bangs in
                        command = .setTag(at: box.index, state: state, bangs: bangs)
                        pressed = nil
                    }
                }
            } else {
                // Only a note still in the cloud takes long enough to be seen here.
                VStack(spacing: 10) {
                    ProgressView()
                    Text(workspace.isLocal(ref) ? "Opening…" : "Downloading from iCloud…")
                        .font(.footnote).foregroundStyle(theme.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.editorBg)
        .ignoresSafeArea(.container, edges: .bottom)
        .navigationTitle(ref.title)
        .navigationBarTitleDisplayMode(.inline)
        // Opaque, or the bar takes the band's pink through its translucency.
        .toolbarBackground(theme.editorBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { if !loaded { text = await workspace.load(ref); onDisk = text; loaded = true } }
        .onChange(of: workspace.notes) { _, _ in
            // the folder changed underneath: take the disk's version when we have nothing unsaved
            if case .note = ref { takeDisk() }
        }
        // An outside file has no watcher; coming back to the app is when it
        // is looked at again.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, case .external = ref { takeDisk() }
        }
        // Only a changed note is written: rewriting an untouched one would
        // bump its date and make every synced device fetch it again.
        .onDisappear { saveTask?.cancel(); if loaded, text != onDisk { workspace.write(ref, text); onDisk = text } }
    }

    private func takeDisk() {
        guard loaded, saveTask == nil || saveTask?.isCancelled == true else { return }
        let disk = workspace.read(ref)
        if disk != text { text = disk; onDisk = disk }
    }
}

/// The Mac's pink band: this file is not in your notes folder — not backed
/// up, not in search — and here is where it is. Tapping opens Files there.
struct ExternalBand: View {
    let file: ExternalFile

    var body: some View {
        Button {
            // Files opens at a path given as shareddocuments://<path>.
            if let url = URL(string: "shareddocuments://" + file.url.path) { UIApplication.shared.open(url) }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder.badge.minus").font(.footnote.weight(.bold))
                Text("External").font(.footnote.weight(.bold))
                Text(file.folderLabel + " › " + file.displayName).font(.footnote).lineLimit(1).truncationMode(.head)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption2.weight(.bold)).opacity(0.8)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14).padding(.vertical, 7)
            .frame(maxWidth: .infinity)
            .background(Color(red: 0.925, green: 0.282, blue: 0.6)) // pink-500, the Mac's --outside
        }
        .buttonStyle(.plain)
        .accessibilityLabel("External file, outside your notes folder. Opens in Files.")
    }
}

struct PressedBox: Identifiable, Equatable {
    let index: Int
    let state: TodoState
    let bangs: String
    var id: Int { index }
}
