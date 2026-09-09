// Every to-do in every note. By note: sections per note, document order,
// nested details under their task. By state: the ⌘⏎ order, priority first
// within a state, the note (or note › parent) above each task.

import ParkerCore
import SwiftUI

struct TasksView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @State private var byState = false

    var body: some View {
        let theme = Theme.current(scheme)
        let all = workspace.tasks()
        NavigationStack {
            List {
                if byState {
                    ForEach(Todo.groupByState(all), id: \.state) { group in
                        Section {
                            ForEach(group.items, id: \.line) { item in
                                TaskRow(item: item, above: Todo.path(of: item, in: all).joined(separator: " › "), theme: theme)
                            }
                        } header: {
                            Text(stateLabel(group.state)).foregroundStyle(theme.stateColor(group.state))
                        }
                    }
                } else {
                    ForEach(workspace.notes, id: \.name) { note in
                        let items = all.filter { $0.note == note.name }
                        if !items.isEmpty {
                            Section(note.name.replacingOccurrences(of: ".md", with: "")) {
                                ForEach(items, id: \.line) { item in TaskRow(item: item, above: nil, theme: theme) }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Tasks")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("View", selection: $byState) { Text("By note").tag(false); Text("By state").tag(true) }
                        .pickerStyle(.segmented).frame(width: 200)
                }
            }
        }
    }

    private func stateLabel(_ st: TodoState) -> String {
        switch st {
        case .todo: return "To do"; case .doing: return "Doing"; case .pause: return "Paused"; case .wait: return "Waiting"
        case .attn: return "Needs you"; case .done: return "Done"; case .fail: return "Failed"; case .cancel: return "Cancelled"
        }
    }
}

struct TaskRow: View {
    let item: TaskItem
    let above: String?
    let theme: Theme

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            TodoBoxView(state: item.state, priority: item.priority, theme: theme, em: 15)
                .padding(.top, above == nil ? 4 : 20)
                .padding(.leading, CGFloat(item.indent) * 6)
            VStack(alignment: .leading, spacing: 2) {
                if let above { Text(above).font(.caption).foregroundStyle(theme.muted).lineLimit(1) }
                Text(item.text).font(.system(size: 15, design: .monospaced)).foregroundStyle(theme.stateColor(item.state))
                ForEach(item.details, id: \.self) { d in
                    Text(d).font(.system(size: 13, design: .monospaced)).foregroundStyle(theme.stateColor(item.state).opacity(0.8)).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
