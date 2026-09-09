// One screen, two paths. Start fresh: a folder of our own (in Files under On
// My iPhone › Parker; the iCloud Drive container comes with the signing
// account). I already have notes: the Files picker.

import SwiftUI
import UniformTypeIdentifiers

struct OnboardingView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @State private var picking = false
    @State private var help = false
    /// Debug builds only: a picked folder whose name doesn't say "dev", held
    /// until the user confirms. A development build must never land on the
    /// real notes by a slip of the finger.
    @State private var suspect: URL?

    var body: some View {
        let theme = Theme.current(scheme)
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)
                    VStack(spacing: 12) {
                        // The brand, as the site wears it: the figure and the wordmark, ink on
                        // paper in the light theme and paper on ink in the dark one.
                        Image("Lockup").resizable().aspectRatio(contentMode: .fit)
                            .frame(width: min(geo.size.width - 96, 250))
                            .padding(.bottom, 10)
                            .accessibilityLabel("Parker")
                        Text("for iPhone")
                            .font(.system(size: 26, weight: .bold)).foregroundStyle(theme.text)
                        Text("The companion to Parker for Mac")
                            .font(.headline).foregroundStyle(theme.text)
                        Text("Your notes are plain files in a folder you own. This app reads the same folder your Mac does. No account, no server of ours, nothing leaves your folder.")
                            .font(.subheadline).multilineTextAlignment(.center).foregroundStyle(theme.secondary)
                            .frame(maxWidth: 320)
                    }
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                    Spacer(minLength: 28)
                    VStack(spacing: 10) {
                        OptionCard(icon: "icloud", title: workspace.busy ? "Setting up your folder…" : "Start fresh",
                                   detail: "A Parker folder in your iCloud Drive. A Mac with Parker finds it by itself. No iCloud? It lives on this phone.",
                                   theme: theme) { if !workspace.busy { workspace.startFresh() } }
                        OptionCard(icon: "folder", title: "I already have notes",
                                   detail: "Pick the folder in Files. iCloud Drive, Google Drive and Dropbox all work.",
                                   theme: theme) { picking = true }
                    }
                    .padding(.horizontal, 20)
                    VStack(spacing: 2) {
                        Button { help = true } label: {
                            Label("Where is my folder?", systemImage: "info.circle").font(.subheadline.weight(.medium))
                        }
                        .tint(theme.accent).frame(height: 40)
                        Link(destination: URL(string: "https://getparker.dev")!) {
                            Text("No Mac app yet? Parker for Mac is free at getparker.dev")
                                .font(.footnote).foregroundStyle(theme.secondary)
                        }
                    }
                    .padding(.top, 8).padding(.bottom, 16)
                    if let err = workspace.lastError {
                        Text(err).font(.footnote).foregroundStyle(.red).padding(.bottom, 12)
                    }
                }
                .frame(minHeight: geo.size.height) // short phones scroll, tall ones centre
            }
        }
        .background(theme.editorBg.ignoresSafeArea())
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            guard case .success(let url) = result else { return }
            #if DEBUG
            if !Workspace.looksLikeDevFolder(url) { suspect = url; return }
            #endif
            workspace.choose(url)
        }
        .alert("This is a development build", isPresented: Binding(get: { suspect != nil }, set: { if !$0 { suspect = nil } })) {
            Button("Pick another folder") { suspect = nil; picking = true }
            Button("Use it anyway", role: .destructive) { if let url = suspect { workspace.choose(url) }; suspect = nil }
        } message: {
            Text("\u{201C}\(suspect.map(Workspace.displayName(of:)) ?? "")\u{201D} doesn\u{2019}t look like a dev folder. A build like this one can rewrite notes while a feature is half done. Point it at a folder with \u{201C}Dev\u{201D} in its name, like the one Parker Dev uses on the Mac.")
        }
        .sheet(isPresented: $help) { WhereIsMyFolderSheet(theme: theme) { help = false; picking = true } }
    }
}

struct OptionCard: View {
    let icon: String, title: String, detail: String
    let theme: Theme
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 20, weight: .medium)).foregroundStyle(theme.accent)
                    .frame(width: 40, height: 40).background(theme.border.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline).foregroundStyle(theme.text)
                    Text(detail).font(.footnote).foregroundStyle(theme.secondary).multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(theme.muted)
            }
            .padding(14)
            .background(theme.editorBg, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
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
            Label("A folder in On My iPhone stays on this phone and will not sync with your Mac. No notes yet? Go back and choose Start fresh.", systemImage: "info.circle")
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
