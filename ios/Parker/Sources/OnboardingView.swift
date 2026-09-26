// The iPhone's first run (Onda 5), after the "Parker iPhone First Run"
// prototype of 24/09 — the sibling of the Mac's welcome screen. Parker looks
// for one folder, Documents › Parker in iCloud Drive (the one the Mac looks
// for too), so whichever device comes first, the other finds it by itself.
// "Continue with iCloud Drive" opens the Files picker already on iCloud Drive:
// one tap on Open is the grant. Cancelling is a path, not a dead end; any
// other folder is "Use another folder". The sentences live in ParkerCore
// (FirstRunText), tested.

import SwiftUI
import UniformTypeIdentifiers
import ParkerCore

struct OnboardingView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scenePhase) private var scenePhase

    /// What the screen shows.
    enum Step: Equatable {
        case welcome, cancelled
        case found(URL), create(URL), arriving(URL)
        case confirm(Choice)
    }
    struct Choice: Equatable {
        var url: URL
        var display: String
        var suggested: Bool
        var onPhone: Bool = false
        var summary: FolderSummary
    }
    enum PickerMode { case grant, other }

    @State private var step: Step = .welcome
    @State private var back: Step = .welcome
    @State private var picking = false
    @State private var mode: PickerMode = .grant
    @State private var root: URL?
    @State private var driveOn = FileManager.default.ubiquityIdentityToken != nil
    @State private var turnedOn = false
    @State private var help = false
    /// Debug builds only: a picked folder whose name doesn't say "dev", held
    /// until the user confirms. A development build must never land on the
    /// real notes by a slip of the finger.
    @State private var suspect: URL?

    private var home: String { "iCloud Drive › Documents › \(NotesHome.folderName(dev: Workspace.devBuild))" }

    var body: some View {
        let theme = Theme.current(scheme)
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header(theme, width: geo.size.width)
                    content(theme)
                    if let err = workspace.lastError {
                        Text(err).font(.footnote).foregroundStyle(.red)
                    }
                }
                .padding(.horizontal, 22).padding(.vertical, 20)
                .frame(minHeight: geo.size.height, alignment: .top)
            }
        }
        .background(theme.editorBg.ignoresSafeArea())
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            picked(result)
        }
        .fileDialogDefaultDirectory(mode == .grant ? root : nil)
        .onChange(of: scenePhase) { _, phase in
            // Back from Settings: iCloud Drive may be on now.
            guard phase == .active else { return }
            let on = workspace.driveOn
            if on && !driveOn { turnedOn = true }
            driveOn = on
        }
        .alert("This is a development build", isPresented: Binding(get: { suspect != nil }, set: { if !$0 { suspect = nil } })) {
            Button("Pick another folder") { suspect = nil; mode = .other; picking = true }
            Button("Use it anyway", role: .destructive) { if let url = suspect { confirmOther(url) }; suspect = nil }
        } message: {
            Text("\u{201C}\(suspect.map(Workspace.displayName(of:)) ?? "")\u{201D} doesn\u{2019}t look like a dev folder. A build like this one can rewrite notes while a feature is half done. Point it at a folder with \u{201C}Dev\u{201D} in its name, like the one Parker Dev uses on the Mac.")
        }
        .sheet(isPresented: $help) { WhereIsMyFolderSheet(theme: theme) { help = false; mode = .other; picking = true } }
    }

    // ---- Screens ----------------------------------------------------------------

    @ViewBuilder private func header(_ theme: Theme, width: CGFloat) -> some View {
        if case .confirm = step {
            Button { step = back } label: { Label("Back", systemImage: "chevron.left").font(.body) }.tint(theme.accent)
        } else {
            // The brand, as the site wears it.
            Image("Lockup").resizable().aspectRatio(contentMode: .fit)
                .frame(width: min(width - 96, 180)).padding(.top, 12).padding(.bottom, 4)
                .accessibilityLabel("Parker")
        }
    }

    @ViewBuilder private func content(_ theme: Theme) -> some View {
        switch step {
        case .welcome: welcome(theme)
        case .cancelled:
            title("No worries.", theme)
            lead("I can't look in iCloud Drive yet, and that's fine. You can try again — the next screen opens on iCloud Drive; just tap **Open** — or choose where your notes live yourself.", theme)
            Spacer(minLength: 12)
            primary("Try again", theme) { continueWithDrive() }
            secondary("Use another folder", theme) { pickOther() }
            link("Start on this iPhone", theme) { confirmOnPhone() }
        case .found(let url), .create(let url):
            let found = { if case .found = step { return true } else { return false } }()
            let s = workspace.summary(of: url)
            title(found ? "Nice — your notes are right here." : "Fresh start.", theme)
            lead(found ? "Right where I'd keep them." : "No notes yet — I'll make them a home in your iCloud Drive.", theme)
            FolderCardView(title: "Documents › \(NotesHome.folderName(dev: Workspace.devBuild))",
                           detail: found ? "in iCloud Drive" : "in iCloud Drive · a new folder with a Welcome note", theme: theme)
            XRayView(summary: s, driveOn: driveOn, theme: theme)
            Spacer(minLength: 12)
            primary(found ? "Use this folder" : "Create it", theme) {
                back = step
                step = .confirm(Choice(url: url, display: home, suggested: true, summary: s))
            }
            link("Use another folder", theme) { pickOther() }
        case .arriving:
            title("Almost there.", theme)
            lead("iCloud is still bringing \(home) to this iPhone. Give it a moment, then try again — making a new one now would leave you with two.", theme)
            Spacer(minLength: 12)
            primary("Try again", theme) { if let root { locate(root) } }
            link("Use another folder", theme) { pickOther() }
        case .confirm(let c): confirm(c, theme)
        }
    }

    @ViewBuilder private func welcome(_ theme: Theme) -> some View {
        title("Hi, I'm Parker.", theme)
        if turnedOn {
            Text("✓ Nice — iCloud Drive is on. Your notes will follow you.").font(.subheadline)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
        }
        if driveOn {
            lead("Your notes are plain Markdown files in one folder — yours, readable by any app and any AI agent. Let's find them first: I'll look in **\(home)**.", theme)
            lead("iOS asks you once to let me look in iCloud Drive: on the next screen, just tap **Open**. I only read my own folder there.", theme)
            Spacer(minLength: 12)
            primary("Continue with iCloud Drive", theme) { continueWithDrive() }
            link("Use another folder", theme) { pickOther() }
        } else {
            lead("Your notes are plain Markdown files in one folder — yours, readable by any app and any AI agent.", theme)
            VStack(alignment: .leading, spacing: 8) {
                Text("**iCloud Drive is off on this iPhone.** With it on, I keep your notes in \(home) and your Mac can open them. Turn it on in Settings › your name › iCloud › Drive, then come back here with \u{201C}◀ Parker\u{201D} at the top.")
                    .font(.subheadline)
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                .buttonStyle(.bordered).tint(theme.accent)
            }
            .padding(12).background(Color.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
            Spacer(minLength: 12)
            primary("Start on this iPhone", theme) { confirmOnPhone() }
            link("Use another folder", theme) { pickOther() }
        }
        VStack(spacing: 2) {
            Button { help = true } label: {
                Label("Where is my folder?", systemImage: "info.circle").font(.subheadline.weight(.medium))
            }
            .tint(theme.accent).frame(height: 40)
            Link(destination: URL(string: "https://getparker.dev")!) {
                Text("No Mac app yet? Parker for Mac is free at getparker.dev").font(.footnote).foregroundStyle(theme.secondary)
            }
            // Continuing past this screen is accepting the terms — said here,
            // once, where the folder is chosen, not as a gate.
            Text("By continuing you accept the [terms](https://getparker.dev/terms) and [privacy policy](https://getparker.dev/privacy).")
                .font(.caption2).foregroundStyle(theme.secondary).tint(theme.accent).multilineTextAlignment(.center).padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func confirm(_ c: Choice, _ theme: Theme) -> some View {
        let s = c.summary
        let git = FirstRunText.git(s)
        title("Here's your setup.", theme)
        VStack(alignment: .leading, spacing: 0) {
            Row(key: "Folder", theme: theme) {
                Text(c.display).font(.subheadline.bold())
                Text(FirstRunText.state(s)).font(.subheadline).foregroundStyle(theme.secondary)
            }
            Row(key: "Suggested?", theme: theme) {
                Text(c.suggested ? "Yes — the folder I suggest." : "Your pick — works just the same. I just won't look for it anywhere else.").font(.subheadline)
            }
            Row(key: "iCloud sync", theme: theme) {
                Text(FirstRunText.sync(s, driveOn: driveOn)).font(.subheadline)
            }
            Row(key: "Git", theme: theme) {
                Text(git.text).font(.subheadline)
                Text(git.note).font(.footnote).foregroundStyle(theme.secondary)
            }
            Row(key: "On the Mac", theme: theme, last: true) {
                Text(FirstRunText.mac(s, suggested: c.suggested, display: c.display)).font(.subheadline)
            }
        }
        .background(theme.border.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))
        if s.sync != .icloud {
            VStack(alignment: .leading, spacing: 6) {
                Text("Other ways to sync").font(.subheadline.bold())
                Text("Parker doesn't sync anything itself — any service that syncs a folder works: Dropbox, Google Drive, OneDrive, Box and others. Install the service's app, then pick its folder with Use another folder. On the Mac, choose the same folder in Parker's welcome screen.")
                    .font(.footnote).foregroundStyle(theme.secondary)
            }
            .padding(12).background(theme.border.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))
        }
        Spacer(minLength: 12)
        primary("Continue", theme) {
            if c.onPhone { workspace.startOnThisPhone() }
            else if c.suggested { workspace.useDefault(c.url) }
            else { workspace.choose(c.url) }
        }
    }

    // ---- Actions ----------------------------------------------------------------

    private func continueWithDrive() {
        Task {
            guard let r = await workspace.driveRoot() else { driveOn = false; step = .welcome; return }
            root = r
            mode = .grant
            picking = true
        }
    }

    private func pickOther() {
        mode = .other
        picking = true
    }

    private func picked(_ result: Result<URL, Error>) {
        guard case .success(let url) = result else {
            // Cancelled: the grant is a path, not a dead end.
            if mode == .grant { step = .cancelled }
            return
        }
        if mode == .grant, let root, url.standardizedFileURL.path == root.standardizedFileURL.path {
            locate(url)
            return
        }
        #if DEBUG
        if !Workspace.looksLikeDevFolder(url) { suspect = url; return }
        #endif
        confirmOther(url)
    }

    private func locate(_ root: URL) {
        switch workspace.grant(root: root) {
        case .found(let f): step = .found(f)
        case .create(let f): step = .create(f)
        case .arriving(let f): step = .arriving(f)
        case nil: step = .cancelled
        }
    }

    private func confirmOther(_ url: URL) {
        let accessing = url.startAccessingSecurityScopedResource()
        let s = FolderSummary.of(url)
        if accessing { url.stopAccessingSecurityScopedResource() }
        back = step
        step = .confirm(Choice(url: url, display: Workspace.displayName(of: url), suggested: false, summary: s))
    }

    private func confirmOnPhone() {
        back = step
        step = .confirm(Choice(url: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0],
                               display: "On My iPhone › Parker", suggested: false, onPhone: true,
                               summary: FolderSummary(exists: true, sync: .onThisPhone)))
    }

    // ---- Pieces -------------------------------------------------------------------

    private func title(_ t: String, _ theme: Theme) -> some View {
        Text(t).font(.system(size: 28, weight: .bold)).foregroundStyle(theme.text)
    }
    private func lead(_ t: String, _ theme: Theme) -> some View {
        Text(.init(t)).font(.body).foregroundStyle(theme.secondary)
    }
    private func primary(_ t: String, _ theme: Theme, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(t).font(.headline).frame(maxWidth: .infinity).frame(height: 50) }
            .buttonStyle(.borderedProminent).tint(theme.accent)
    }
    private func secondary(_ t: String, _ theme: Theme, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(t).font(.headline).frame(maxWidth: .infinity).frame(height: 50) }
            .buttonStyle(.bordered).tint(theme.accent)
    }
    private func link(_ t: String, _ theme: Theme, _ action: @escaping () -> Void) -> some View {
        Button(t, action: action).font(.body).tint(theme.accent).frame(maxWidth: .infinity)
    }

    struct Row<Content: View>: View {
        let key: String
        let theme: Theme
        var last = false
        @ViewBuilder let content: () -> Content
        var body: some View {
            VStack(alignment: .leading, spacing: 3) {
                Text(key.uppercased()).font(.system(size: 10, design: .monospaced)).foregroundStyle(theme.muted)
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .overlay(alignment: .bottom) { if !last { theme.border.frame(height: 1) } }
        }
    }
}

/// The suggested folder, as a card.
struct FolderCardView: View {
    let title: String, detail: String
    let theme: Theme
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "folder.fill").font(.system(size: 26)).foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(title).font(.headline).foregroundStyle(theme.text)
                    Text("suggested").font(.system(size: 10, design: .monospaced)).padding(.horizontal, 6).padding(.vertical, 1)
                        .background(theme.accent.opacity(0.15), in: Capsule()).foregroundStyle(theme.accent)
                }
                Text(detail).font(.footnote).foregroundStyle(theme.secondary)
            }
            Spacer()
        }
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(theme.accent, lineWidth: 1.5))
    }
}

/// Screen 1's x-ray of the suggested folder: contents, iCloud, git.
struct XRayView: View {
    let summary: FolderSummary
    let driveOn: Bool
    let theme: Theme
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            line("Contents", FirstRunText.contents(summary))
            line("iCloud", driveOn ? "Syncs with iCloud Drive" : "iCloud Drive is off on this iPhone")
            line("Git", summary.git ? "Git repository" + (summary.gitRemote.map { " · \($0)" } ?? "") : summary.exists ? "Not a git repository" : "—", last: true)
        }
        .padding(.horizontal, 14)
        .background(theme.border.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))
    }
    private func line(_ k: String, _ v: String, last: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(k.uppercased()).font(.system(size: 10, design: .monospaced)).foregroundStyle(theme.muted).frame(width: 74, alignment: .leading)
            Text(v).font(.subheadline).foregroundStyle(theme.text)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { if !last { theme.border.frame(height: 1) } }
    }
}

struct WhereIsMyFolderSheet: View {
    let theme: Theme
    let openFiles: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Where is my folder?").font(.title2.bold())
            Step(n: 1, text: "On your Mac, open Parker and look at Settings → Notes folder.")
            Step(n: 2, text: "If that folder is in iCloud Drive, pick the same folder here. Your notes appear in seconds.")
            Step(n: 3, text: "If your Mac syncs Desktop & Documents with iCloud, the folder is under iCloud Drive › Documents.")
            Label("A folder in On My iPhone stays on this phone and will not sync with your Mac. No notes yet? Go back and choose Continue with iCloud Drive.", systemImage: "info.circle")
                .font(.footnote).foregroundStyle(theme.secondary)
                .padding(12).background(theme.border.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
            Button(action: openFiles) { Text("Open Files").frame(maxWidth: .infinity).frame(height: 50) }
                .buttonStyle(.borderedProminent).tint(theme.accent)
        }
        .padding(20)
        .presentationDetents([.medium, .large])
    }

    struct Step: View {
        let n: Int, text: String
        var body: some View {
            HStack(alignment: .top, spacing: 14) {
                Text("\(n)").font(.footnote.bold()).frame(width: 26, height: 26).background(.quaternary, in: Circle())
                Text(text).font(.callout)
            }
        }
    }
}
