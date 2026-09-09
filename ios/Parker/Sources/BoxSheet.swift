// The long press on a box: every state, drawn as the box draws it, and the
// priority — the two things a tap cannot reach in one go. Picking applies at
// once; "Remove the tag" turns the line back into plain text.

import ParkerCore
import SwiftUI

struct BoxSheet: View {
    let current: TodoState
    let bangs: String
    let theme: Theme
    let pick: (TodoState?, String) -> Void

    @State private var priority: Int

    init(current: TodoState, bangs: String, theme: Theme, pick: @escaping (TodoState?, String) -> Void) {
        self.current = current
        self.bangs = bangs
        self.theme = theme
        self.pick = pick
        _priority = State(initialValue: bangs.count)
    }

    private static let names: [TodoState: String] = [
        .todo: "To do", .doing: "Doing", .pause: "Paused", .wait: "Waiting",
        .attn: "Needs attention", .done: "Done", .fail: "Failed", .cancel: "Cancelled",
    ]

    var body: some View {
        NavigationStack {
            List {
                Section("Priority") {
                    // The four levels as the empty box wears them: the border's colour.
                    HStack(spacing: 8) {
                        ForEach(0..<4, id: \.self) { level in
                            Button {
                                priority = level
                                pick(current, String(repeating: "!", count: level))
                            } label: {
                                VStack(spacing: 6) {
                                    TodoBoxView(state: .todo, priority: level, theme: theme, em: 22)
                                    Text(level == 0 ? "none" : String(repeating: "!", count: level))
                                        .font(.system(size: 13, design: .monospaced))
                                        .foregroundStyle(level == 0 ? theme.secondary : theme.priorityColor(level))
                                }
                                .frame(maxWidth: .infinity).padding(.vertical, 8)
                                .background(level == priority ? theme.border.opacity(0.5) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Section("State") {
                    ForEach(TodoState.order, id: \.self) { state in
                        Button { pick(state, String(repeating: "!", count: priority)) } label: {
                            HStack(spacing: 12) {
                                TodoBoxView(state: state, priority: priority, theme: theme, em: 17)
                                Text(Self.names[state] ?? state.rawValue).foregroundStyle(theme.text)
                                Spacer()
                                Text("/" + state.rawValue).font(.system(size: 13, design: .monospaced)).foregroundStyle(theme.muted)
                                if state == current { Image(systemName: "checkmark").foregroundStyle(theme.accent) }
                            }
                        }
                    }
                }
                Section {
                    Button("Remove the tag", role: .destructive) { pick(nil, "") }
                }
            }
            .navigationTitle("This task")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}
