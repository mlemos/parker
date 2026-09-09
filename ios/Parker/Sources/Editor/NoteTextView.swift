// The editor: a UITextView over NoteStorage. After every edit the paragraph
// under the cursor is normalised — a tag that became complete turns into its
// box, a box whose tag was broken turns back into text — then the whole note
// is restyled. A tap on a box cycles the state, as a click does on the Mac.

import ParkerCore
import SwiftUI
import UIKit

/// What a box's long-press sheet asks the editor to do.
enum EditorCommand: Equatable {
    /// Rewrite the box at storage index `at` (nil state removes the tag).
    case setTag(at: Int, state: TodoState?, bangs: String)
}

/// A text view whose own gestures keep off the boxes: a touch that begins on a
/// box belongs to the box's tap and long press alone — no caret placement,
/// no selection, no edit menu from the text view underneath.
final class BoxTextView: UITextView {
    var isBox: ((CGPoint) -> Bool)?
    var boxRecognizers: [UIGestureRecognizer] = []

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if !boxRecognizers.contains(where: { $0 === g }), let isBox, isBox(g.location(in: self)) { return false }
        return super.gestureRecognizerShouldBegin(g)
    }
}

struct NoteTextView: UIViewRepresentable {
    @Binding var text: String
    let theme: Theme
    var onChange: (String) -> Void
    /// A long press on a box: its storage index and what it is now.
    var onBoxLongPress: (Int, TodoAttachment) -> Void = { _, _ in }
    @Binding var command: EditorCommand?

    func makeUIView(context: Context) -> UITextView {
        let tv = BoxTextView(usingTextLayoutManager: false) // TextKit 1: attachments and hit-testing behave
        tv.delegate = context.coordinator
        tv.backgroundColor = UIColor(theme.editorBg)
        tv.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 200, right: 8)
        tv.autocorrectionType = .no
        tv.autocapitalizationType = .none
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        tv.smartInsertDeleteType = .no
        tv.keyboardDismissMode = .interactive
        tv.alwaysBounceVertical = true
        tv.tintColor = UIColor(theme.accent)
        // The box's two gestures, UIKit's own way: the tap waits for the long
        // press to fail, which a lifted finger does at once; a held one opens
        // the sheet and the tap never fires. Both receive touches on boxes only.
        let press = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pressed(_:)))
        press.minimumPressDuration = 0.3
        press.delegate = context.coordinator
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delegate = context.coordinator
        tap.require(toFail: press)
        tv.addGestureRecognizer(press)
        tv.addGestureRecognizer(tap)
        tv.boxRecognizers = [press, tap]
        tv.isBox = { [weak coordinator = context.coordinator] point in
            guard let coordinator, let tv = coordinator.textView else { return false }
            return coordinator.box(at: point, in: tv) != nil
        }
        // Pinch = the Mac's interface zoom: the text size, kept between notes.
        let pinch = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pinched(_:)))
        pinch.delegate = context.coordinator
        tv.addGestureRecognizer(pinch)
        context.coordinator.textView = tv
        tv.inputAccessoryView = context.coordinator.makeBar(theme)
        context.coordinator.load(text)
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.parent = self
        tv.backgroundColor = UIColor(theme.editorBg)
        tv.tintColor = UIColor(theme.accent)
        // Reload when the file changed underneath (not when we wrote it), and
        // when the theme changed: colours and the boxes' images are baked in.
        if context.coordinator.lastEmitted != text, NoteStorage.plainText(tv.attributedText) != text {
            context.coordinator.load(text)
        } else if context.coordinator.styledWith != theme.def.id || context.coordinator.styledAtSize != NoteStorage.fontSize {
            tv.inputAccessoryView = context.coordinator.makeBar(theme)
            tv.reloadInputViews()
            context.coordinator.load(NoteStorage.plainText(tv.attributedText))
        }
        if let cmd = command {
            context.coordinator.perform(cmd)
            DispatchQueue.main.async { command = nil }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: NoteTextView
        weak var textView: UITextView?
        var lastEmitted: String?
        var styledWith: String?
        var styledAtSize: CGFloat = 0
        private var normalizing = false
        private var pinchStartSize: CGFloat = 0
        /// While a touch that began on a box is recent, the text view's own
        /// edit menu (Select, Select All, AutoFill) stays away.
        private var boxTouchUntil = Date.distantPast

        init(_ parent: NoteTextView) { self.parent = parent }

        func load(_ text: String) {
            guard let tv = textView else { return }
            let sel = tv.selectedRange
            let s = NoteStorage.attributed(from: text, theme: parent.theme)
            Perf.timed("setAttributedText") { tv.attributedText = s }
            Perf.timed("ensureLayout") { tv.layoutManager.ensureLayout(for: tv.textContainer) }
            tv.selectedRange = NSRange(location: min(sel.location, tv.attributedText.length), length: 0)
            lastEmitted = text
            styledWith = parent.theme.def.id
            styledAtSize = NoteStorage.fontSize
        }

        @objc func pinched(_ g: UIPinchGestureRecognizer) {
            guard let tv = textView else { return }
            switch g.state {
            case .began: pinchStartSize = NoteStorage.fontSize
            case .changed:
                let wanted = (pinchStartSize * g.scale * 2).rounded() / 2 // half-point steps
                let size = min(max(wanted, NoteStorage.fontSizeRange.lowerBound), NoteStorage.fontSizeRange.upperBound)
                guard size != NoteStorage.fontSize else { return }
                NoteStorage.fontSize = size
                // keep the text under the fingers where it is: scale the offset with the size
                let ratio = size / styledAtSize
                let offset = tv.contentOffset
                let sel = tv.selectedRange
                tv.attributedText = NoteStorage.attributed(from: NoteStorage.plainText(tv.attributedText), theme: parent.theme)
                tv.selectedRange = NSRange(location: min(sel.location, tv.attributedText.length), length: 0)
                tv.setContentOffset(CGPoint(x: 0, y: max(0, offset.y * ratio)), animated: false)
                styledAtSize = size
            default: break
            }
        }

        // ---- Editing ----------------------------------------------------------------------

        /// Enter continues a task or a list item and ends an empty one — the
        /// core's planEnter, on the note's plain text. Anything else is typed.
        func textView(_ tv: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard text == "\n", range.length == 0 else { return true }
            let (plain, from, _) = plainSelection(tv)
            let doc = TextDocument(plain)
            let line = doc.lineAt(from)
            switch Todo.planEnter(line: line.text, col: from - line.from) {
            case .newline:
                return true
            case .exit(let a, let b):
                applyPlain(replace(plain, Change(from: line.from + a, to: line.from + b)), caret: line.from + a, in: tv)
                return false
            case .continue(let prefix):
                let insert = "\n" + prefix
                applyPlain(replace(plain, Change(from: from, insert: insert)), caret: from + insert.utf16.count, in: tv)
                return false
            }
        }

        func textViewDidChange(_ tv: UITextView) {
            guard !normalizing else { return }
            normalizing = true
            normalizeParagraph(at: tv.selectedRange.location, in: tv)
            restyle(tv)
            normalizing = false
            emit(tv)
        }

        private func emit(_ tv: UITextView) {
            let text = NoteStorage.plainText(tv.attributedText)
            lastEmitted = text
            parent.text = text
            parent.onChange(text)
        }

        /// The paragraph under the cursor, made to match the grammar: its file
        /// form decides whether it starts with a box, and which one.
        private func normalizeParagraph(at location: Int, in tv: UITextView) {
            guard let storage = tv.textStorage as NSMutableAttributedString?, storage.length > 0 else { return }
            let ns = storage.string as NSString
            let pr = ns.paragraphRange(for: NSRange(location: min(location, ns.length), length: 0))
            let contentLength = pr.length - (pr.location + pr.length <= ns.length && pr.length > 0 && ns.character(at: pr.location + pr.length - 1) == 10 ? 1 : 0)
            let content = NSRange(location: pr.location, length: contentLength)
            let current = storage.attributedSubstring(from: content)
            let fileLine = NoteStorage.plainText(current)
            let wanted = NoteStorage.paragraph(from: fileLine, theme: parent.theme)
            // Same structure already? Compare the storage strings (attachment char included) and the tags.
            if current.string == wanted.string, tagOf(current) == tagOf(wanted) { return }
            let caret = tv.selectedRange.location
            let offsetFromEnd = max(0, content.location + content.length - caret)
            storage.replaceCharacters(in: content, with: wanted)
            let newEnd = content.location + wanted.length
            tv.selectedRange = NSRange(location: max(content.location, newEnd - offsetFromEnd), length: 0)
        }

        private func tagOf(_ s: NSAttributedString) -> String? {
            var found: String?
            s.enumerateAttribute(.attachment, in: NSRange(location: 0, length: s.length)) { v, _, stop in
                if let a = v as? TodoAttachment { found = a.tagText; stop.pointee = true }
            }
            return found
        }

        private func restyle(_ tv: UITextView) {
            let sel = tv.selectedRange
            let s = NSMutableAttributedString(attributedString: tv.attributedText)
            NoteStorage.style(s, theme: parent.theme)
            tv.textStorage.setAttributedString(s)
            tv.selectedRange = sel
        }

        // ---- Tapping the box: complete or reopen, like the Mac's click -----------------------

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        /// The box's tap and press act on boxes only; a touch on text is the
        /// text view's. The pinch takes every touch: it is the whole note's zoom.
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            if g is UIPinchGestureRecognizer { return true }
            guard let tv = textView else { return false }
            return box(at: touch.location(in: tv), in: tv) != nil
        }

        // The system treats an attachment as an image: a tap would open it and a
        // long press would offer "Copy Image". A box is neither; ours take over.
        func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
            if case .textAttachment = textItem.content { return nil }
            return defaultAction
        }

        func textView(_ textView: UITextView, menuConfigurationFor textItem: UITextItem, defaultMenu: UIMenu) -> UITextItem.MenuConfiguration? {
            if case .textAttachment = textItem.content { return nil }
            return .init(menu: defaultMenu)
        }

        /// No edit menu for a touch that began on a box: that touch is a tap or the sheet.
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            if Date() < boxTouchUntil { return nil }
            let s = textView.textStorage
            for i in [range.location - 1, range.location] where i >= 0 && i < s.length {
                if s.attribute(.attachment, at: i, effectiveRange: nil) is TodoAttachment { return nil }
            }
            return UIMenu(children: suggestedActions)
        }


        /// The box under a point, if the point is on the box itself.
        func box(at point: CGPoint, in tv: UITextView) -> (Int, TodoAttachment)? {
            let inContainer = CGPoint(x: point.x - tv.textContainerInset.left, y: point.y - tv.textContainerInset.top)
            var index = tv.layoutManager.characterIndex(for: inContainer, in: tv.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            // just past the box the nearest character is the space after it: look one back
            if index > 0, index < tv.textStorage.length, !(tv.textStorage.attribute(.attachment, at: index, effectiveRange: nil) is TodoAttachment),
               tv.textStorage.attribute(.attachment, at: index - 1, effectiveRange: nil) is TodoAttachment { index -= 1 }
            guard index < tv.textStorage.length,
                  let a = tv.textStorage.attribute(.attachment, at: index, effectiveRange: nil) as? TodoAttachment else { return nil }
            // the target is the whole line height, from the left edge to a little past the box
            let glyphRect = tv.layoutManager.boundingRect(forGlyphRange: NSRange(location: index, length: 1), in: tv.textContainer)
            let target = CGRect(x: -tv.textContainerInset.left, y: glyphRect.minY - 6,
                                width: glyphRect.maxX + tv.textContainerInset.left + 8, height: glyphRect.height + 12)
            guard target.contains(inContainer) else { return nil }
            return (index, a)
        }

        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let tv = textView, let (index, a) = box(at: g.location(in: tv), in: tv) else { return }
            boxTouchUntil = Date().addingTimeInterval(1)
            setTag(at: index, state: Todo.nextOnClick(a.state, alt: false), bangs: a.bangs)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }

        @objc func pressed(_ g: UILongPressGestureRecognizer) {
            guard g.state == .began, let tv = textView, let (index, a) = box(at: g.location(in: tv), in: tv) else { return }
            boxTouchUntil = Date().addingTimeInterval(1.5)
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            parent.onBoxLongPress(index, a)
        }

        /// Rewrite the box at `index`: a new state and priority, or no tag at all.
        func setTag(at index: Int, state: TodoState?, bangs: String) {
            guard let tv = textView, index < tv.textStorage.length,
                  tv.textStorage.attribute(.attachment, at: index, effectiveRange: nil) is TodoAttachment else { return }
            if let state {
                let replacement = TodoAttachment(state: state, bangs: bangs, em: NoteStorage.fontSize, theme: parent.theme)
                tv.textStorage.replaceCharacters(in: NSRange(location: index, length: 1), with: NSAttributedString(attachment: replacement))
            } else {
                // the tag and the one space after it, as the Mac's delete-into-box does
                let ns = tv.textStorage.string as NSString
                let hasSpace = index + 1 < ns.length && ns.character(at: index + 1) == 0x20
                tv.textStorage.replaceCharacters(in: NSRange(location: index, length: hasSpace ? 2 : 1), with: "")
            }
            restyle(tv)
            emit(tv)
        }

        func perform(_ cmd: EditorCommand) {
            switch cmd {
            case .setTag(let at, let state, let bangs): setTag(at: at, state: state, bangs: bangs)
            }
        }

        // ---- The bar above the keyboard -----------------------------------------------------
        //
        // Every button works on the note's plain text, with the Mac's rules,
        // then the storage is rebuilt from it: one path for all of them.

        func makeBar(_ theme: Theme) -> UIView {
            let bar = UIInputView(frame: CGRect(x: 0, y: 0, width: 0, height: 44), inputViewStyle: .keyboard)
            bar.backgroundColor = UIColor(theme.editorBg)
            let hairline = UIView(); hairline.backgroundColor = UIColor(theme.border)
            let scroll = UIScrollView(); scroll.showsHorizontalScrollIndicator = false
            let stack = UIStackView(); stack.axis = .horizontal; stack.spacing = 4; stack.alignment = .center
            let mono = UIFont(name: "GeistMono-Medium", size: 17) ?? .monospacedSystemFont(ofSize: 17, weight: .medium)
            func button(_ title: String?, _ symbol: String?, _ action: Selector, wide: Bool = false) -> UIButton {
                var cfg = UIButton.Configuration.plain()
                if let title { cfg.attributedTitle = AttributedString(title, attributes: AttributeContainer([.font: mono])) }
                if let symbol { cfg.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)) }
                cfg.baseForegroundColor = UIColor(theme.text)
                cfg.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: wide ? 12 : 10, bottom: 6, trailing: wide ? 12 : 10)
                let b = UIButton(configuration: cfg)
                b.addTarget(self, action: action, for: .touchUpInside)
                return b
            }
            let rotate = button(nil, "arrow.triangle.2.circlepath", #selector(barRotate))
            rotate.accessibilityLabel = "Rotate to-do"
            [rotate,
             button("!", nil, #selector(barPriority)),
             button("#", nil, #selector(barHeading)),
             button("-", nil, #selector(barList)),
             button(nil, "increase.indent", #selector(barIndent)),
             button(nil, "decrease.indent", #selector(barOutdent))].forEach(stack.addArrangedSubview)
            let dismiss = button(nil, "keyboard.chevron.compact.down", #selector(barDismiss))
            for v in [hairline, scroll, dismiss] { v.translatesAutoresizingMaskIntoConstraints = false; bar.addSubview(v) }
            stack.translatesAutoresizingMaskIntoConstraints = false
            scroll.addSubview(stack)
            NSLayoutConstraint.activate([
                hairline.topAnchor.constraint(equalTo: bar.topAnchor), hairline.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
                hairline.trailingAnchor.constraint(equalTo: bar.trailingAnchor), hairline.heightAnchor.constraint(equalToConstant: 0.5),
                dismiss.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -4), dismiss.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
                scroll.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 4), scroll.trailingAnchor.constraint(equalTo: dismiss.leadingAnchor),
                scroll.topAnchor.constraint(equalTo: bar.topAnchor), scroll.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
                stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
                stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
                stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
            ])
            return bar
        }

        /// The note as plain text and the selection in file offsets.
        private func plainSelection(_ tv: UITextView) -> (text: String, from: Int, to: Int) {
            let s = tv.attributedText!
            let sel = tv.selectedRange
            return (NoteStorage.plainText(s), NoteStorage.fileOffset(in: s, storage: sel.location), NoteStorage.fileOffset(in: s, storage: sel.location + sel.length))
        }

        /// Rebuild the storage from new plain text and put the caret at file offset `caret`.
        private func applyPlain(_ text: String, caret: Int, in tv: UITextView) {
            let s = NoteStorage.attributed(from: text, theme: parent.theme)
            let offset = tv.contentOffset
            tv.attributedText = s
            tv.selectedRange = NSRange(location: NoteStorage.storageOffset(in: s, file: caret), length: 0)
            tv.setContentOffset(offset, animated: false) // the edit is on the caret's line: stay put
            styledWith = parent.theme.def.id
            emit(tv)
        }

        private func replace(_ text: String, _ change: Change) -> String {
            (text as NSString).replacingCharacters(in: NSRange(location: change.from, length: (change.to ?? change.from) - change.from), with: change.insert ?? "")
        }

        @objc private func barRotate() {
            guard let tv = textView else { return }
            let (text, from, to) = plainSelection(tv)
            let changes = Todo.planRotate(TextDocument(text), from: from, to: to)
            guard !changes.isEmpty else { return }
            var out = text
            for c in changes.sorted(by: { $0.from > $1.from }) { out = replace(out, c) }
            let caret = Todo.cursorAfterRotate(changes, head: to) ?? mapped(to, through: changes)
            applyPlain(out, caret: caret, in: tv)
        }

        /// Where a position lands after `changes`.
        private func mapped(_ pos: Int, through changes: [Change]) -> Int {
            var p = pos
            for c in changes where c.from <= pos {
                let removed = (c.to ?? c.from) - c.from, inserted = c.insert?.utf16.count ?? 0
                p += inserted - min(removed, pos - c.from)
            }
            return max(0, p)
        }

        /// none → ! → !! → !!! → none, on the line's tag; a line without one is left alone.
        @objc private func barPriority() {
            editLine { line, tag in
                guard let tag else { return nil }
                let next = tag.bangs.count >= 3 ? "" : tag.bangs + "!"
                return Change(from: line.from + tag.indent.utf16.count, to: line.from + tag.length, insert: "/" + tag.state.rawValue + next)
            }
        }

        /// none → # → ## → ### → none, at the start of the line.
        @objc private func barHeading() {
            editLine { line, _ in
                let hashes = line.text.prefix { $0 == "#" }.count
                let hasMark = hashes > 0 && line.text.dropFirst(hashes).first == " "
                let width = hasMark ? hashes + 1 : 0
                let next = hasMark ? (hashes >= 3 ? "" : String(repeating: "#", count: hashes + 1) + " ") : "# "
                return Change(from: line.from, to: line.from + width, insert: next)
            }
        }

        /// A list marker after the indentation, or its removal.
        @objc private func barList() {
            editLine { line, _ in
                let indent = Todo.leadingWhitespaceUTF16(line.text)
                let rest = String(line.text.utf16.dropFirst(indent)) ?? ""
                if rest.hasPrefix("- ") { return Change(from: line.from + indent, to: line.from + indent + 2) }
                return Change(from: line.from + indent, insert: "- ")
            }
        }

        @objc private func barIndent() { editLine { line, _ in Change(from: line.from, insert: "  ") } }
        @objc private func barOutdent() {
            editLine { line, _ in
                let n = min(2, Todo.leadingWhitespaceUTF16(line.text))
                return n > 0 ? Change(from: line.from, to: line.from + n) : nil
            }
        }
        @objc private func barDismiss() { textView?.resignFirstResponder() }

        /// One change on the caret's line, caret kept on the same text.
        private func editLine(_ make: (DocLine, Todo.Tag?) -> Change?) {
            guard let tv = textView else { return }
            let (text, from, _) = plainSelection(tv)
            let doc = TextDocument(text)
            let line = doc.lineAt(from)
            guard let c = make(line, Todo.tag(of: line.text)) else { return }
            applyPlain(replace(text, c), caret: mapped(from, through: [c]), in: tv)
        }
    }
}
