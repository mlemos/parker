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

    var body: some View {
        let theme = Theme.current(scheme)
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 12) {
                Image(systemName: "checkmark.square").font(.system(size: 56, weight: .regular)).foregroundStyle(theme.text)
                Text("Your notes, as plain files in a folder you own.")
                    .font(.system(size: 28, weight: .bold)).multilineTextAlignment(.center)
                    .foregroundStyle(theme.text)
                Text("No account. No servers of ours, ever. The folder syncs however you like, and any app can read it.")
                    .font(.body).multilineTextAlignment(.center).foregroundStyle(theme.secondary)
                    .frame(maxWidth: 320)
            }
            .padding(.horizontal, 28)
            Spacer()
            VStack(spacing: 10) {
                OptionCard(icon: "icloud", title: "Start fresh",
                           detail: "We create a Parker folder for you. Your notes appear in Files, and a Mac with Parker can open the same files.",
                           theme: theme) { workspace.startFresh() }
                OptionCard(icon: "folder", title: "I already have notes",
                           detail: "Pick the folder in Files. iCloud Drive, Google Drive and Dropbox all work.",
                           theme: theme) { picking = true }
                Button { help = true } label: {
                    Label("Where is my folder?", systemImage: "info.circle").font(.subheadline.weight(.medium))
                }
                .tint(theme.accent).frame(height: 44)
            }
            .padding(.horizontal, 20).padding(.bottom, 24)
            if let err = workspace.lastError {
                Text(err).font(.footnote).foregroundStyle(.red).padding(.bottom, 12)
            }
        }
        .background(theme.editorBg.ignoresSafeArea())
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { workspace.choose(url) }
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
