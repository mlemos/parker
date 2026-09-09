// The editor: a UITextView over NoteStorage. After every edit the paragraph
// under the cursor is normalised — a tag that became complete turns into its
// box, a box whose tag was broken turns back into text — then the whole note
// is restyled. A tap on a box cycles the state, as a click does on the Mac.

import ParkerCore
import SwiftUI
import UIKit

struct NoteTextView: UIViewRepresentable {
    @Binding var text: String
    let theme: Theme
    var onChange: (String) -> Void

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView(usingTextLayoutManager: false) // TextKit 1: attachments and hit-testing behave
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
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delegate = context.coordinator
        tv.addGestureRecognizer(tap)
        context.coordinator.textView = tv
        context.coordinator.load(text)
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.parent = self
        tv.backgroundColor = UIColor(theme.editorBg)
        // Reload only when the file changed underneath (not when we wrote it).
        if context.coordinator.lastEmitted != text, NoteStorage.plainText(tv.attributedText) != text {
            context.coordinator.load(text)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: NoteTextView
        weak var textView: UITextView?
        var lastEmitted: String?
        private var normalizing = false

        init(_ parent: NoteTextView) { self.parent = parent }

        func load(_ text: String) {
            guard let tv = textView else { return }
            let sel = tv.selectedRange
            tv.attributedText = NoteStorage.attributed(from: text, theme: parent.theme)
            tv.selectedRange = NSRange(location: min(sel.location, tv.attributedText.length), length: 0)
            lastEmitted = text
        }

        // ---- Editing ----------------------------------------------------------------------

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

        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let tv = textView else { return }
            let point = g.location(in: tv)
            let inContainer = CGPoint(x: point.x - tv.textContainerInset.left, y: point.y - tv.textContainerInset.top)
            let index = tv.layoutManager.characterIndex(for: inContainer, in: tv.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            guard index < tv.textStorage.length,
                  let a = tv.textStorage.attribute(.attachment, at: index, effectiveRange: nil) as? TodoAttachment else { return }
            // only when the tap really lands on the box, not on the line's text
            let glyphRect = tv.layoutManager.boundingRect(forGlyphRange: NSRange(location: index, length: 1), in: tv.textContainer)
            guard glyphRect.insetBy(dx: -6, dy: -4).contains(inContainer) else { return }
            let next = Todo.nextOnClick(a.state, alt: false)
            let replacement = TodoAttachment(state: next, bangs: a.bangs, em: NoteStorage.fontSize, theme: parent.theme)
            tv.textStorage.replaceCharacters(in: NSRange(location: index, length: 1), with: NSAttributedString(attachment: replacement))
            restyle(tv)
            emit(tv)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
