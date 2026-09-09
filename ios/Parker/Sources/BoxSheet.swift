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
                    Picker("Priority", selection: $priority) {
                        Text("None").tag(0)
                        Text("!").tag(1)
                        Text("!!").tag(2)
                        Text("!!!").tag(3)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: priority) { _, new in pick(current, String(repeating: "!", count: new)) }
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
