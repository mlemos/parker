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

    init(name: String, focusLine: Int? = nil) { self.init(ref: .note(name), focusLine: focusLine) }
    init(ref: NoteRef, focusLine: Int? = nil) {
        self.ref = ref
        self.focusLine = focusLine
        _current = State(initialValue: ref)
    }
    /// What the editor holds now: `ref`, until a draft's first save makes it
    /// a note with a name.
    @State private var current: NoteRef
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
            if case .external(let file) = current {
                ExternalBand(file: file)
            }
            if loaded {
                NoteTextView(text: $text, theme: theme, focusLine: focusLine, onChange: { new in
                    saveTask?.cancel()
                    saveTask = Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(500))
                        if !Task.isCancelled { save(new) }
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
                    Text(workspace.isLocal(current) ? "Opening…" : "Downloading from iCloud…")
                        .font(.footnote).foregroundStyle(theme.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.editorBg)
        .ignoresSafeArea(.container, edges: .bottom)
        .navigationTitle(current.title)
        .navigationBarTitleDisplayMode(.inline)
        // Opaque, or the bar takes the band's pink through its translucency.
        .toolbarBackground(theme.editorBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { if !loaded { text = await workspace.load(current); onDisk = text; loaded = true } }
        .onChange(of: workspace.notes) { _, _ in
            // the folder changed underneath: take the disk's version when we have nothing unsaved
            if case .note = current { takeDisk() }
        }
        // An outside file has no watcher; coming back to the app is when it
        // is looked at again.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, case .external = current { takeDisk() }
        }
        // Only a changed note is written: rewriting an untouched one would
        // bump its date and make every synced device fetch it again.
        .onDisappear { saveTask?.cancel(); if loaded, text != onDisk { save(text) } }
    }

    /// Write the note — or, for a draft with something in it, make its file
    /// and become that note. A draft still empty (or only blank) writes
    /// nothing: walking away from a new note leaves no file behind.
    private func save(_ new: String) {
        if case .draft(let folder, _) = current {
            guard !new.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            if let name = workspace.materialize(in: folder, text: new) {
                current = .note(name)
                onDisk = new
            }
            return
        }
        workspace.write(current, new)
        onDisk = new
    }

    private func takeDisk() {
        guard loaded, saveTask == nil || saveTask?.isCancelled == true else { return }
        let disk = workspace.read(current)
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
