// The iPhone's first run (Onda 5), after the "Parker iPhone First Run"
// prototype of 24/09 — the sibling of the Mac's welcome screen, refined on
// 27/09 to match it one for one. Parker looks for one folder, Documents ›
// Parker in iCloud Drive (the one the Mac looks for too), so whichever device
// comes first, the other finds it by itself. "Continue with iCloud Drive"
// opens the Files picker already on iCloud Drive: one tap on Open is the
// grant. Cancelling is a path, not a dead end; any other folder is "Choose
// another folder".
//
// Both apps' screens have the same shape: the site's lockup on the first one,
// Back and the head on the others, the same folder card, x-ray and setup rows
// with the same marks. Every word is t("…") from shared/first-run-copy.json
// (ParkerCore FirstRunCopy), the file the Mac reads too.

import SwiftUI
import UniformTypeIdentifiers
import ParkerCore

/// A sentence of the first run, from the file both apps read.
private func t(_ key: String, _ vars: [String: String] = [:]) -> String { FirstRunCopy.shared.text(key, vars) }

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

    private var folderName: String { NotesHome.folderName(dev: Workspace.devBuild) }
    private var home: String { "iCloud Drive › Documents › \(folderName)" }

    var body: some View {
        let theme = Theme.current(scheme)
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if step == .welcome {
                        // The welcome sits in the upper third, where the eye
                        // looks first: one part of the free space above it,
                        // two below, never less than a margin either way.
                        Spacer(minLength: 20)
                        welcome(theme)
                        Spacer(minLength: 24)
                        Spacer(minLength: 0)
                        // The small print scrolls with the page: pinned with
                        // the buttons, it takes half a small screen at large
                        // text sizes.
                        footer(theme).frame(maxWidth: .infinity)
                    } else {
                        top(theme)
                        content(theme)
                    }
                    if let err = workspace.lastError {
                        Text(err).font(.footnote).foregroundStyle(.red)
                    }
                }
                .padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 20)
                .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .topLeading)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        // The buttons stay at the bottom, over the text, as on the Mac.
        .safeAreaInset(edge: .bottom) { actions(theme) }
        .background(theme.editorBg.ignoresSafeArea())
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            picked(result)
        }
        .fileDialogDefaultDirectory(mode == .grant ? root : nil)
        .onChange(of: scenePhase) { _, phase in
            // Back from Settings: iCloud Drive may be on now.
            guard phase == .active else { return }
            #if DEBUG
            if UserDefaults.standard.string(forKey: "onboarding") != nil { return } // a screenshot state keeps its -driveOn
            #endif
            let on = workspace.driveOn
            if on && !driveOn { turnedOn = true }
            driveOn = on
        }
        .alert(t("dev.title"), isPresented: Binding(get: { suspect != nil }, set: { if !$0 { suspect = nil } })) {
            Button(t("dev.other")) { suspect = nil; mode = .other; picking = true }
            Button(t("dev.anyway"), role: .destructive) { if let url = suspect { confirmOther(url) }; suspect = nil }
        } message: {
            Text(t("dev.message", ["folder": suspect.map(Workspace.displayName(of:)) ?? ""]))
        }
        .sheet(isPresented: $help) { WhereIsMyFolderSheet(theme: theme) { help = false; mode = .other; picking = true } }
        #if DEBUG
        .onAppear(perform: screenshotState)
        #endif
    }

    // ---- Screens ----------------------------------------------------------------

    /// The site's lockup on the first screen; Back and the head on the others.
    @ViewBuilder private func top(_ theme: Theme) -> some View {
        if step == .welcome {
            EmptyView() // the welcome carries the lockup itself
        } else {
            HStack {
                Button { step = backStep } label: {
                    Label(t("back"), systemImage: "chevron.left").font(.body)
                }
                .tint(theme.accent)
                Spacer()
                Image("ParkerHead").resizable().scaledToFit().frame(width: 24, height: 24)
                    .foregroundStyle(theme.muted).accessibilityLabel("Parker")
            }
            .frame(height: 44)
        }
    }

    private var backStep: Step {
        if case .confirm = step { return back }
        return .welcome
    }

    @ViewBuilder private func content(_ theme: Theme) -> some View {
        switch step {
        case .welcome: welcome(theme)
        case .cancelled:
            title(t("denied.title"), theme)
            lead(t("denied.lead"), theme)
        case .found(let url), .create(let url):
            let found = { if case .found = step { return true } else { return false } }()
            let s = workspace.summary(of: url)
            let folder = "Documents › \(folderName)"
            title(t(found ? "found.title" : "create.title"), theme)
            lead(found ? t("found.lead", ["contents": FirstRunText.contents(s), "folder": folder]) : t("create.lead", ["folder": folder]), theme)
            FolderCardView(title: folder, tag: t("card.suggested"), detail: t("card.inICloud"), theme: theme)
            XRayView(summary: s, driveOn: driveOn, theme: theme)
        case .arriving:
            title(t("arriving.title"), theme)
            lead(t("arriving.lead", ["device": "iPhone"]), theme)
        case .confirm(let c): confirm(c, theme)
        }
    }

    @ViewBuilder private func welcome(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Lockup(theme: theme).padding(.bottom, 22)
            title(t("welcome.title"), theme)
            lead(t("welcome.lead"), theme)
            if turnedOn {
                Label(t("welcome.driveOn"), systemImage: "checkmark.circle.fill")
                    .font(.subheadline).foregroundStyle(theme.text).tint(theme.accent)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            }
            if driveOn {
                lead(t("welcome.look", ["home": home]), theme)
            } else {
                // iCloud Drive off: one line of what, one of why, and the way there.
                HStack(alignment: .top, spacing: 10) {
                    StatusIcon(tone: .warn, theme: theme)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("welcome.driveOff")).font(.subheadline.weight(.semibold)).foregroundStyle(theme.text)
                        Text(t("welcome.driveOffDetail")).font(.subheadline).foregroundStyle(theme.secondary)
                        Button(t("welcome.openSettings")) {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                        .font(.subheadline.weight(.medium)).tint(theme.accent).padding(.top, 2)
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.border.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
            }
            // The question comes up while reading this, so the answer is here.
            Button { help = true } label: {
                Label(t("welcome.help"), systemImage: "info.circle").font(.subheadline)
            }
            .tint(theme.accent).padding(.top, 6)
        }
    }

    @ViewBuilder private func confirm(_ c: Choice, _ theme: Theme) -> some View {
        let s = c.summary
        let sync = FirstRunText.sync(s, driveOn: driveOn)
        let git = FirstRunText.git(s)
        title(t("setup.title"), theme)
        VStack(alignment: .leading, spacing: 0) {
            Row(key: t("setup.folder"), theme: theme) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(c.display).font(.subheadline.bold()).foregroundStyle(theme.text)
                    Tag(text: t(c.suggested ? "card.suggested" : "card.yourChoice"), quiet: !c.suggested, theme: theme)
                }
                Marked(tone: FirstRunText.stateTone(s), text: FirstRunText.state(s), theme: theme)
            }
            Row(key: t("setup.sync"), theme: theme) {
                Marked(tone: sync.tone, text: sync.text, theme: theme)
                if let note = FirstRunText.syncNote(s) { Callout(text: note, theme: theme) }
            }
            Row(key: t("setup.git"), theme: theme) {
                Marked(tone: git.tone, text: git.text, theme: theme)
                Text(git.note).font(.footnote).foregroundStyle(theme.secondary)
            }
            Row(key: t("setup.otherDevice"), theme: theme, last: true) {
                Text(FirstRunText.mac(s, suggested: c.suggested, display: c.display)).font(.subheadline).foregroundStyle(theme.text)
                if let note = FirstRunText.macNote(s, display: c.display) { Callout(text: note, theme: theme) }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(theme.border))
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 6) {
                Text(t("setup.otherWaysBody"))
                Text(t("setup.otherWaysHow"))
            }
            .font(.footnote).foregroundStyle(theme.secondary).padding(.top, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Text(t("setup.otherWays")).font(.subheadline.weight(.semibold)).foregroundStyle(theme.text)
        }
        .tint(theme.secondary)
        .padding(.horizontal, 14).padding(.vertical, 10)
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(theme.border))
    }

    /// Each screen's buttons, at the bottom: the one thing to do, then the way out.
    @ViewBuilder private func actions(_ theme: Theme) -> some View {
        VStack(spacing: 6) {
            switch step {
            case .welcome:
                if driveOn {
                    primary(t("welcome.primary"), theme) { continueWithDrive() }
                } else {
                    primary(t("welcome.startHere"), theme) { confirmOnPhone() }
                }
                link(t("choose"), theme) { pickOther() }
            case .cancelled:
                primary(t("retry"), theme) { continueWithDrive() }
                link(t("choose"), theme) { pickOther() }
                link(t("welcome.startHere"), theme) { confirmOnPhone() }
            case .found(let url), .create(let url):
                let found = { if case .found = step { return true } else { return false } }()
                primary(t(found ? "found.primary" : "create.primary"), theme) {
                    back = step
                    step = .confirm(Choice(url: url, display: home, suggested: true, summary: workspace.summary(of: url)))
                }
                link(t("choose"), theme) { pickOther() }
            case .arriving:
                primary(t("retry"), theme) { if let root { locate(root) } }
                link(t("choose"), theme) { pickOther() }
            case .confirm(let c):
                primary(t("continue"), theme) {
                    if c.onPhone { workspace.startOnThisPhone() }
                    else if c.suggested { workspace.useDefault(c.url) }
                    else { workspace.choose(c.url) }
                }
            }
        }
        .padding(.horizontal, 24).padding(.top, 10).padding(.bottom, 6)
        .background(theme.editorBg)
    }

    @ViewBuilder private func footer(_ theme: Theme) -> some View {
        VStack(spacing: 3) {
            Text(.init(t("welcome.otherApp"))).font(.footnote).foregroundStyle(theme.secondary)
            // Continuing past this screen is accepting the terms — said here,
            // once, where the folder is chosen, not as a gate.
            Text(.init(t("welcome.terms"))).font(.caption2).foregroundStyle(theme.muted)
        }
        .tint(theme.accent).multilineTextAlignment(.center)
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

    #if DEBUG
    /// Debug builds: open straight on one state, for screenshots of every
    /// screen without iCloud (the Mac's twin is src/harness.local/firstrun):
    ///   -onboarding welcome|turned-on|cancelled|found|create|arriving|confirm|confirm-other|confirm-phone|help
    ///   -driveOn 0|1
    /// The folders are made in the app's own tmp, with sample notes.
    private func screenshotState() {
        let args = UserDefaults.standard
        guard let state = args.string(forKey: "onboarding") else { return }
        if args.object(forKey: "driveOn") != nil { driveOn = args.bool(forKey: "driveOn") }
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("onboarding-shots")
        // Under a "Mobile Documents" path, so it reads as iCloud Drive, as the real one would.
        let folder = base.appendingPathComponent("Mobile Documents/com~apple~CloudDocs/Documents/\(folderName)")
        try? fm.removeItem(at: base)
        if state == "found" {
            try? fm.createDirectory(at: folder.appendingPathComponent(".git"), withIntermediateDirectories: true)
            try? "[remote \"origin\"]\n\turl = https://github.com/you/notes.git\n".write(to: folder.appendingPathComponent(".git/config"), atomically: true, encoding: .utf8)
            for i in 1...42 { try? "# Note \(i)\n".write(to: folder.appendingPathComponent("note-\(i).md"), atomically: true, encoding: .utf8) }
        }
        let iCloudSummary = FolderSummary(exists: true, notes: 42, git: true, gitRemote: "github.com/you/notes", sync: .icloud)
        switch state {
        case "turned-on": turnedOn = true; driveOn = true
        case "cancelled": step = .cancelled
        case "found": step = .found(folder)
        case "create": step = .create(folder)
        case "arriving": step = .arriving(folder)
        case "confirm": back = .found(folder); step = .confirm(Choice(url: folder, display: home, suggested: true, summary: iCloudSummary))
        case "confirm-other":
            back = .welcome
            step = .confirm(Choice(url: folder, display: "Google Drive › My Drive › Notes", suggested: false,
                                   summary: FolderSummary(exists: true, notes: 56, other: 4, sync: .googleDrive)))
        case "confirm-phone": back = .welcome; confirmOnPhone()
        case "help": help = true
        default: break
        }
    }
    #endif

    // ---- Pieces -------------------------------------------------------------------

    private func title(_ s: String, _ theme: Theme) -> some View {
        // .title is 28 points at the default size, and grows with the reader's text size.
        Text(s).font(.title.bold()).tracking(-0.4).foregroundStyle(theme.text).padding(.top, 2)
    }
    private func lead(_ s: String, _ theme: Theme) -> some View {
        Text(.init(s)).font(.body).foregroundStyle(theme.secondary).fixedSize(horizontal: false, vertical: true)
    }
    private func primary(_ s: String, _ theme: Theme, _ action: @escaping () -> Void) -> some View {
        // Two lines when the text is large, rather than "Continue with iCloud…".
        Button(action: action) {
            Text(s).font(.headline).multilineTextAlignment(.center).lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 50).padding(.vertical, 2)
        }
        .buttonStyle(.borderedProminent).tint(theme.accent)
    }
    private func link(_ s: String, _ theme: Theme, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(s).multilineTextAlignment(.center) }
            .font(.body).tint(theme.accent).frame(maxWidth: .infinity, minHeight: 36)
    }

    struct Row<Content: View>: View {
        let key: String
        let theme: Theme
        var last = false
        @ViewBuilder let content: () -> Content
        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                Text(key.uppercased()).font(.system(size: 10, design: .monospaced)).tracking(0.6).foregroundStyle(theme.muted)
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.vertical, 11)
            .overlay(alignment: .bottom) { if !last { theme.border.frame(height: 1) } }
        }
    }
}

/// The site's lockup, as the Mac draws it: the head and the lowercase wordmark
/// in Geist Mono.
struct Lockup: View {
    let theme: Theme
    var body: some View {
        HStack(spacing: 12) {
            Image("ParkerHead").resizable().scaledToFit().frame(width: 46, height: 46)
            Text("parker").font(.custom("GeistMono-Regular", size: 27).weight(.medium)).tracking(-1.2)
        }
        .foregroundStyle(theme.text)
        .accessibilityElement(children: .ignore).accessibilityLabel("Parker")
    }
}

/// A line's mark, as the Mac's: ✓ in the accent, ! and ? filled, – outlined.
struct StatusIcon: View {
    let tone: Tone
    let theme: Theme
    var body: some View {
        switch tone {
        case .ok: Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(theme.accent).frame(width: 16, height: 16)
        case .warn: Image(systemName: "exclamationmark.circle.fill").font(.system(size: 15)).foregroundStyle(Color(css: theme.def.todo.attn))
        case .unknown: Image(systemName: "questionmark.circle.fill").font(.system(size: 15)).foregroundStyle(theme.muted)
        case .none: Image(systemName: "minus.circle").font(.system(size: 15)).foregroundStyle(theme.muted)
        }
    }
}

/// Something the user has to act on, in the to-do "attention" amber: a tinted
/// box with its mark, so it isn't read past like the quiet lines around it.
/// The Mac's .fr-rec.fr-caveat is the same box: same tint, same mark.
struct Callout: View {
    let text: String
    let theme: Theme
    var body: some View {
        let amber = Color(css: theme.def.todo.attn)
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Image(systemName: "exclamationmark.circle.fill").font(.system(size: 13)).foregroundStyle(amber)
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
            Text(text).font(.footnote).foregroundStyle(theme.text).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .padding(.top, 4)
    }
}

/// A sentence with its mark before it.
struct Marked: View {
    let tone: Tone
    let text: String
    let theme: Theme
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            StatusIcon(tone: tone, theme: theme).alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 5 }
            Text(text).font(.subheadline).foregroundStyle(tone == .none ? theme.secondary : theme.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// "Suggested" in the accent, "Your choice" quiet.
struct Tag: View {
    let text: String
    var quiet = false
    let theme: Theme
    var body: some View {
        Text(text).font(.system(size: 10, weight: .medium, design: .monospaced))
            .padding(.horizontal, 7).padding(.vertical, 1)
            .background((quiet ? theme.text.opacity(0.09) : theme.accent.opacity(0.15)), in: Capsule())
            .foregroundStyle(quiet ? theme.secondary : theme.accent)
    }
}

/// The suggested folder, as a card: its name and tag, then where it is.
struct FolderCardView: View {
    let title: String, tag: String, detail: String
    let theme: Theme
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "folder.fill").font(.system(size: 28)).foregroundStyle(Color(red: 0.23, green: 0.62, blue: 1))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline).foregroundStyle(theme.text).lineLimit(2)
                HStack(spacing: 6) {
                    Tag(text: tag, theme: theme)
                    Text(detail).font(.footnote).foregroundStyle(theme.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(theme.accent, lineWidth: 1.5))
    }
}

/// The found / fresh-start screens' x-ray of the suggested folder: sync, git.
struct XRayView: View {
    let summary: FolderSummary
    let driveOn: Bool
    let theme: Theme
    var body: some View {
        let sync = FirstRunText.sync(summary, driveOn: driveOn)
        let git = FirstRunText.git(summary)
        VStack(alignment: .leading, spacing: 0) {
            line(t("xray.sync"), sync.tone, sync.text)
            line(t("xray.git"), git.tone, git.text, last: true)
        }
        .padding(.horizontal, 14)
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(theme.border))
    }
    private func line(_ k: String, _ tone: Tone, _ v: String, last: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(k.uppercased()).font(.system(size: 10, design: .monospaced)).tracking(0.6).foregroundStyle(theme.muted).frame(width: 44, alignment: .leading)
            Marked(tone: tone, text: v, theme: theme)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 9)
        .overlay(alignment: .bottom) { if !last { theme.border.frame(height: 1) } }
    }
}

struct WhereIsMyFolderSheet: View {
    let theme: Theme
    let openFiles: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(t("help.title")).font(.title2.bold()).padding(.top, 8)
                Step(n: 1, text: t("help.step1"))
                Step(n: 2, text: t("help.step2"))
                Step(n: 3, text: t("help.step3"))
                Label(t("help.note"), systemImage: "info.circle")
                    .font(.footnote).foregroundStyle(theme.secondary).fixedSize(horizontal: false, vertical: true)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.border.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
                Button(action: openFiles) { Text(t("help.open")).font(.headline).frame(maxWidth: .infinity).frame(height: 50) }
                    .buttonStyle(.borderedProminent).tint(theme.accent)
            }
            .padding(24)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    struct Step: View {
        let n: Int, text: String
        var body: some View {
            HStack(alignment: .top, spacing: 14) {
                Text("\(n)").font(.footnote.bold()).frame(width: 26, height: 26).background(.quaternary, in: Circle())
                Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
