// To-do rendering and interaction. Six states, one per leading slash tag:
//
//   /TODO   open       — empty box
//   /DOING  in progress — cyan box, play           (/WIP = alias)
//   /PAUSE  parked by you — blue box, pause        (/PAUSED, /HOLD = aliases)
//   /WAIT   parked by someone else — slate box, hourglass
//                                                  (/WAITING, /BLOCKED = aliases)
//   /ATTN   attention  — amber box, asterisk
//   /DONE   done       — green box, check; line goes green
//   /FAIL   failed     — red box, x; line goes red      (/MISSED = alias)
//   /CANCEL dismissed  — gray box, minus; line goes muted (/DISMISSED = alias)
//
// A tag at the start of a line renders as a clickable checkbox widget in place
// of the tag. The document stays plain text — every interaction rewrites the
// tag through a normal editor transaction, so autosave and git sync see an
// ordinary edit. Color carries the state — never a strikethrough.
//
// The colors are derived from the machine rather than picked: /TODO is the
// origin (no fill), DONE/FAIL/CANCEL are the three poles, and every live state
// wears a diluted version of the pole it is drifting toward — DOING is green
// not yet arrived, ATTN is red not yet arrived, and PAUSE/WAIT decay from
// DOING's cyan toward CANCEL's grey. App.css holds the values.
//
// The checkbox behaves as ONE character that owns the start of the line: it
// never expands back into text on its own, arrows step over it in a single
// press (EditorView.atomicRanges), and Backspace after it / Delete before it
// remove the whole marker. Earlier versions revealed the raw tag whenever the
// caret came near, which shifted the line under the cursor and left vertical
// movement measuring against a layout that had just changed. The caret can
// still sit before the box — the file is plain text and nothing is off-limits;
// typing there simply stops the line matching, and the text reappears.
//
// Interactions:
//   click     any open state → DONE; DONE/FAIL/CANCEL → TODO
//   ⌥-click   TODO → DOING → PAUSE → WAIT → ATTN → FAIL → CANCEL → TODO;
//             DONE → ATTN
//   ⌘↩        rotate the line (Roam-style): no tag → /TODO → /DOING → /PAUSE
//             → /WAIT → /ATTN → /DONE → /FAIL → /CANCEL → tag removed
//             Over a multi-line selection: untagged lines become /TODO, or if
//             every line is tagged they all advance together — one transaction.
//
// The tag grammar and the edits these produce live in todo-model.ts (no DOM),
// which is where the selection→lines rules are unit-tested.
//
// Bare TODO/DONE elsewhere in the text is left alone (a #tag chip system may
// come later). This is a plain decoration pass over the visible range — no
// parser — so it works in every file type and layers on top of the theme.
import {
  Decoration,
  EditorView,
  Prec,
  ViewPlugin,
  RangeSetBuilder,
  WidgetType,
  keymap,
} from "@uiw/react-codemirror";
import type { DecorationSet, ViewUpdate } from "@uiw/react-codemirror";
import { kindOf, todoGlyphSvg } from "./todo-glyph";
import {
  LINE_TAG,
  ownersForRange,
  cursorAfterRotate,
  nextOnClick,
  norm,
  planRotate,
  tagChange,
} from "./todo-model";

// A to-do's nested lines wear its colour, dimmed — so an entry and its detail
// read as one group instead of the detail wearing the generic list colour and
// belonging to nothing.
//
// Every state is here, TODO included. "No fill, no hue" describes its *hue*,
// not the absence of a colour: an open to-do is drawn in body text, so its
// children are body text dimmed. Leaving it out left those lines wearing the
// list colour, the one thing this exists to stop.
export const CHILD_DECOS: Record<string, Decoration> = {
  TODO: Decoration.line({ class: "cm-todo-child-todo" }),
  DOING: Decoration.line({ class: "cm-todo-child-doing" }),
  PAUSE: Decoration.line({ class: "cm-todo-child-pause" }),
  WAIT: Decoration.line({ class: "cm-todo-child-wait" }),
  ATTN: Decoration.line({ class: "cm-todo-child-attn" }),
  DONE: Decoration.line({ class: "cm-todo-child-done" }),
  FAIL: Decoration.line({ class: "cm-todo-child-fail" }),
  CANCEL: Decoration.line({ class: "cm-todo-child-cancel" }),
};

export const LINE_DECOS: Record<string, Decoration> = {
  DOING: Decoration.line({ class: "cm-todo-line-doing" }),
  WIP: Decoration.line({ class: "cm-todo-line-doing" }),
  PAUSE: Decoration.line({ class: "cm-todo-line-pause" }),
  PAUSED: Decoration.line({ class: "cm-todo-line-pause" }),
  HOLD: Decoration.line({ class: "cm-todo-line-pause" }),
  WAIT: Decoration.line({ class: "cm-todo-line-wait" }),
  WAITING: Decoration.line({ class: "cm-todo-line-wait" }),
  BLOCKED: Decoration.line({ class: "cm-todo-line-wait" }),
  ATTN: Decoration.line({ class: "cm-todo-line-attn" }),
  DONE: Decoration.line({ class: "cm-todo-line-done" }),
  FAIL: Decoration.line({ class: "cm-todo-line-fail" }),
  MISSED: Decoration.line({ class: "cm-todo-line-fail" }),
  CANCEL: Decoration.line({ class: "cm-todo-line-cancel" }),
  DISMISSED: Decoration.line({ class: "cm-todo-line-cancel" }),
};

class TodoBox extends WidgetType {
  constructor(readonly state: string) {
    super();
  }
  eq(other: TodoBox) {
    return other.state === this.state;
  }
  toDOM() {
    const box = document.createElement("span");
    const kind = kindOf(norm(this.state));
    box.className = `cm-todo-box cm-todo-box-${kind}`;
    // The visible square. Inner element so it can be drawn from the zero-height
    // anchor (see App.css) without nudging the line's baseline.
    const glyph = document.createElement("span");
    glyph.className = "cm-todo-glyph";
    // Same markup the preview inlines — see todo-glyph.ts. Our own constants,
    // no user text, so there is nothing here to sanitise.
    glyph.innerHTML = todoGlyphSvg(kind);
    box.appendChild(glyph);
    box.title =
      kind === "done" || kind === "fail" || kind === "cancel"
        ? "Reopen (⌥-click: needs attention)"
        : "Mark done (⌥-click: cycle doing/paused/waiting/attention/fail/cancel · ⌘↩ rotate)";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", kind === "done" ? "true" : "false");
    return box;
  }
  // Let events bubble to the editor so the plugin's mousedown handler runs.
  ignoreEvent() {
    return false;
  }
}

interface Built {
  decorations: DecorationSet;
  /** The widget ranges, so the editor can treat them as single units. */
  atomic: DecorationSet;
}

function build(view: EditorView): Built {
  const builder = new RangeSetBuilder<Decoration>();
  const atomic = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;

  for (const { from, to } of view.visibleRanges) {
    const firstLine = doc.lineAt(from).number;
    // Who owns each visible line. Computed for the whole range at once because
    // finding the owner means looking above the viewport, not just within it.
    const owners = ownersForRange(doc, firstLine, doc.lineAt(to).number);

    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const tag = LINE_TAG.exec(line.text);
      if (tag) {
        const state = tag[2];
        const tagFrom = line.from + tag[1].length;
        const tagTo = tagFrom + 1 + state.length;
        const lineDeco = LINE_DECOS[state];
        if (lineDeco) builder.add(line.from, line.from, lineDeco);
        const widget = Decoration.replace({ widget: new TodoBox(state) });
        builder.add(tagFrom, tagTo, widget);
        atomic.add(tagFrom, tagTo, widget);
      } else {
        const owner = owners[line.number - firstLine];
        const childDeco = owner ? CHILD_DECOS[owner] : undefined;
        if (childDeco) builder.add(line.from, line.from, childDeco);
      }

      pos = line.to + 1;
    }
  }
  return { decorations: builder.finish(), atomic: atomic.finish() };
}

function writeTag(
  view: EditorView,
  line: { from: number; text: string },
  tag: RegExpExecArray,
  next: string | null
) {
  view.dispatch({
    changes: tagChange(line, tag, next),
    userEvent: next ? "input" : "delete",
  });
}

/** Checkbox click: complete/reopen; ⌥ cycles the attention/fail/cancel states. */
function toggle(view: EditorView, pos: number, alt: boolean): boolean {
  const line = view.state.doc.lineAt(pos);
  const tag = LINE_TAG.exec(line.text);
  if (!tag) return false;
  writeTag(view, line, tag, nextOnClick(norm(tag[2]), alt));
  return true;
}

/** ⌘↩ — see planRotate for the rules. One transaction, so one undo reverts. */
function rotateLine(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const changes = planRotate(view.state.doc, sel.from, sel.to);
  if (!changes.length) return true;
  const cursor = cursorAfterRotate(changes, sel.head);
  view.dispatch({
    changes,
    ...(cursor === null ? {} : { selection: { anchor: cursor } }),
    userEvent: "input",
  });
  return true;
}

/**
 * Deleting into the checkbox removes the whole marker (and the space that
 * separated it from the text) rather than one character of it. The editor only
 * skips an atomic range when the caret is *inside* it, so without this,
 * Backspace after the box — or Delete before it — would eat a single letter
 * and silently turn "/TODO" into text that no longer marks anything.
 */
const deleteMarker = (backward: boolean) => (view: EditorView): boolean => {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  const tag = LINE_TAG.exec(line.text);
  if (!tag) return false;
  const from = line.from + tag[1].length;
  const to = from + 1 + tag[2].length;
  if (sel.head !== (backward ? to : from)) return false;
  const hasSpace = line.text[tag[0].length] === " ";
  view.dispatch({
    changes: { from, to: to + (hasSpace ? 1 : 0) },
    userEvent: "delete",
  });
  return true;
};

export const todoKeymap = Prec.highest(
  keymap.of([
    { key: "Mod-Enter", run: rotateLine },
    { key: "Backspace", run: deleteMarker(true) },
    { key: "Delete", run: deleteMarker(false) },
  ])
);

class TodoPlugin {
  decorations: DecorationSet;
  atomic: DecorationSet;

  constructor(view: EditorView) {
    ({ decorations: this.decorations, atomic: this.atomic } = build(view));
  }

  // Nothing here depends on the selection, so moving the cursor — by any
  // means, in any direction — costs nothing and changes nothing on screen.
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged)
      ({ decorations: this.decorations, atomic: this.atomic } = build(u.view));
  }
}

export const todoHighlighter = ViewPlugin.fromClass(TodoPlugin, {
  decorations: (v) => v.decorations,
  // Cursor motion and deletion treat each checkbox as one unit.
  provide: (plugin) =>
    EditorView.atomicRanges.of(
      (view) => view.plugin(plugin)?.atomic ?? Decoration.none
    ),
  eventHandlers: {
    mousedown(e, view) {
      const box = (e.target as HTMLElement).closest?.(".cm-todo-box");
      if (!box) return false;
      e.preventDefault();
      return toggle(view, view.posAtDOM(box), e.altKey);
    },
  },
});
