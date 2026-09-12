// Every to-do in every note, and what you do with them from here. By note:
// sections per note, document order, nested details under their task. By
// state: the ⌘⏎ order, priority first within a state, the note (or note ›
// parent) above each task. A tap on the box completes or reopens, a held
// finger opens the state sheet, a tap on the row opens the note at that line,
// the chips narrow the list, and + adds a task to the Inbox note.

import ParkerCore
import SwiftUI

/// Which tasks the list shows.
enum TaskFilter: String, CaseIterable, Identifiable {
    case open = "Open", todo = "To do", doing = "Doing", waiting = "Waiting", done = "Done", all = "All"
    var id: String { rawValue }

    func keeps(_ item: TaskItem) -> Bool {
        switch self {
        case .all: return true
        case .open: return item.state.isOpen
        case .todo: return item.state == .todo
        case .doing: return item.state == .doing
        case .waiting: return item.state == .wait || item.state == .pause || item.state == .attn
        case .done: return item.state == .done || item.state == .fail || item.state == .cancel
        }
    }
}

/// A task to open in its note.
struct TaskTarget: Hashable {
    let note: String
    let line: Int
}

struct TasksView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.colorScheme) private var scheme
    @State private var byState = false
    @State private var filter: TaskFilter = .open
    @State private var pressed: TaskItem?
    @State private var adding = false
    @State private var newTask = ""

    var body: some View {
        let theme = Theme.current(scheme)
        let all = workspace.tasks()
        let shown = all.filter(filter.keeps)
        NavigationStack {
            VStack(spacing: 0) {
                chips(theme)
                List {
                    if shown.isEmpty {
                        Text(all.isEmpty ? "No tasks yet. Tag a line /TODO in any note, or add one here." : "Nothing \(filter.rawValue.lowercased()) right now.")
                            .font(.subheadline).foregroundStyle(theme.secondary)
                            .listRowBackground(Color.clear)
                    } else if byState {
                        ForEach(Todo.groupByState(shown), id: \.state) { group in
                            Section {
                                ForEach(group.items, id: \.line) { item in
                                    row(item, above: Todo.path(of: item, in: all).joined(separator: " › "), theme)
                                }
                            } header: {
                                Text(stateLabel(group.state)).foregroundStyle(theme.stateColor(group.state))
                            }
                        }
                    } else {
                        ForEach(workspace.notes, id: \.name) { note in
                            let items = shown.filter { $0.note == note.name }
                            if !items.isEmpty {
                                Section(note.name.replacingOccurrences(of: ".md", with: "")) {
                                    ForEach(items, id: \.line) { item in row(item, above: nil, theme) }
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Tasks")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("View", selection: $byState) { Text("By note").tag(false); Text("By state").tag(true) }
                        .pickerStyle(.segmented).frame(width: 200)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Add task")
                }
            }
            .navigationDestination(for: TaskTarget.self) { t in NoteView(name: t.note, focusLine: t.line) }
            .sheet(item: $pressed) { item in
                BoxSheet(current: item.state, bangs: String(repeating: "!", count: item.priority), theme: theme) { state, bangs in
                    workspace.setTask(item, state: state, bangs: bangs)
                    pressed = nil
                }
            }
            .alert("New task", isPresented: $adding) {
                TextField("What needs doing?", text: $newTask)
                Button("Add") { workspace.addTask(newTask); newTask = "" }
                Button("Cancel", role: .cancel) { newTask = "" }
            } message: {
                Text("It goes to the Inbox note in your folder.")
            }
        }
    }

    private func chips(_ theme: Theme) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(TaskFilter.allCases) { f in
                    Button { filter = f } label: {
                        Text(f.rawValue)
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(f == filter ? theme.accent : theme.border.opacity(0.5), in: Capsule())
                            .foregroundStyle(f == filter ? Color.white : theme.text)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 8)
        }
    }

    private func row(_ item: TaskItem, above: String?, _ theme: Theme) -> some View {
        NavigationLink(value: TaskTarget(note: item.note, line: item.line)) {
            TaskRow(item: item, above: above, theme: theme,
                    onTap: { workspace.setTask(item, state: Todo.nextOnClick(item.state, alt: false), bangs: String(repeating: "!", count: item.priority)) },
                    onHold: { pressed = item })
        }
    }

    private func stateLabel(_ st: TodoState) -> String {
        switch st {
        case .todo: return "To do"; case .doing: return "Doing"; case .pause: return "Paused"; case .wait: return "Waiting"
        case .attn: return "Needs you"; case .done: return "Done"; case .fail: return "Failed"; case .cancel: return "Cancelled"
        }
    }
}

extension TaskItem: @retroactive Identifiable {
    public var id: String { note + "#" + String(line) }
}

struct TaskRow: View {
    let item: TaskItem
    let above: String?
    let theme: Theme
    var onTap: () -> Void = {}
    var onHold: () -> Void = {}

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // The box, with a thumb-sized target: a tap completes or reopens,
            // a held finger opens the sheet, and neither opens the note.
            TodoBoxView(state: item.state, priority: item.priority, theme: theme, em: 17)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
                .onTapGesture { onTap(); UIImpactFeedbackGenerator(style: .light).impactOccurred() }
                .onLongPressGesture(minimumDuration: 0.3) { UIImpactFeedbackGenerator(style: .medium).impactOccurred(); onHold() }
                .padding(.top, above == nil ? -4 : 12)
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
