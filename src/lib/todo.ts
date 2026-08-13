// To-do rendering and interaction. Five states, one per leading slash tag:
//
//   /TODO   open       — empty box
//   /ATTN   attention  — yellow box, "!" glyph
//   /DONE   done       — green box, check; line goes green
//   /FAIL   failed     — red box, x; line goes red      (/MISSED = alias)
//   /CANCEL dismissed  — gray box, minus; line goes muted (/DISMISSED = alias)
//
// A tag at the start of a line renders as a clickable checkbox widget in place
// of the tag. The document stays plain text — every interaction rewrites the
// tag through a normal editor transaction, so autosave and git sync see an
// ordinary edit. Color carries the state — never a strikethrough.
//
// The checkbox is an ATOMIC range: arrows step over the whole tag in one go
// instead of walking its hidden characters, and Backspace after it removes the
// marker. This matters more than it sounds — the tag used to expand into raw
// text whenever the cursor was near it, which moved the line under the caret
// and left vertical movement measuring against a layout that had just changed
// (down from column 9 landed on column 0). The raw tag now appears only while
// you are actually typing it, never while navigating.
//
// Interactions:
//   click     TODO/ATTN → DONE; DONE/FAIL/CANCEL → TODO (complete / reopen)
//   ⌥-click   TODO → ATTN → FAIL → CANCEL → TODO; DONE → ATTN
//   ⌘↩        rotate the line (Roam-style):
//             no tag → /TODO → /ATTN → /DONE → /FAIL → /CANCEL → tag removed
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
import {
  LINE_TAG,
  cursorAfterRotate,
  nextOnClick,
  norm,
  planRotate,
  tagChange,
} from "./todo-model";

/** Raw-tag highlight, shown while the selection touches the tag. */
const MARKS: Record<string, Decoration> = {
  TODO: Decoration.mark({ class: "cm-todo cm-todo-todo" }),
  ATTN: Decoration.mark({ class: "cm-todo cm-todo-attn" }),
  DONE: Decoration.mark({ class: "cm-todo cm-todo-done" }),
  FAIL: Decoration.mark({ class: "cm-todo cm-todo-fail" }),
  MISSED: Decoration.mark({ class: "cm-todo cm-todo-fail" }),
  CANCEL: Decoration.mark({ class: "cm-todo cm-todo-cancel" }),
  DISMISSED: Decoration.mark({ class: "cm-todo cm-todo-cancel" }),
};

const LINE_DECOS: Record<string, Decoration> = {
  ATTN: Decoration.line({ class: "cm-todo-line-attn" }),
  DONE: Decoration.line({ class: "cm-todo-line-done" }),
  FAIL: Decoration.line({ class: "cm-todo-line-fail" }),
  MISSED: Decoration.line({ class: "cm-todo-line-fail" }),
  CANCEL: Decoration.line({ class: "cm-todo-line-cancel" }),
  DISMISSED: Decoration.line({ class: "cm-todo-line-cancel" }),
};

/** Lucide icon paths (inlined — the widget is plain DOM, no React). */
const GLYPH_PATHS: Record<string, string[]> = {
  // check — path spans y 6–17 (center 11.5), viewBox shifted to compensate
  done: ["M20 6 9 17l-5-5"],
  // x
  fail: ["M18 6 6 18", "m6 6 12 12"],
  // minus — the classic "dismissed / not applicable"
  cancel: ["M5 12h14"],
  // exclamation (circle-alert's inner strokes)
  attn: ["M12 6v7", "M12 17.5h.01"],
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
    const state = norm(this.state);
    const kind =
      state === "TODO"
        ? "todo"
        : state === "ATTN"
          ? "attn"
          : state === "DONE"
            ? "done"
            : state === "FAIL"
              ? "fail"
              : "cancel";
    box.className = `cm-todo-box cm-todo-box-${kind}`;
    // The visible square. Inner element so it can be drawn from the zero-height
    // anchor (see App.css) without nudging the line's baseline.
    const glyph = document.createElement("span");
    glyph.className = "cm-todo-glyph";
    if (kind !== "todo") {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", kind === "done" ? "0 -0.5 24 24" : "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "3.5");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      for (const d of GLYPH_PATHS[kind]) {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        svg.appendChild(p);
      }
      glyph.appendChild(svg);
    }
    box.appendChild(glyph);
    box.title =
      kind === "todo" || kind === "attn"
        ? "Mark done (⌥-click: cycle attention/fail/cancel · ⌘↩ rotate)"
        : "Reopen (⌥-click: needs attention)";
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

function build(view: EditorView, typingLine: number | null): Built {
  const builder = new RangeSetBuilder<Decoration>();
  const atomic = new RangeSetBuilder<Decoration>();
  const { doc, selection } = view.state;
  const sel = selection.main;

  for (const { from, to } of view.visibleRanges) {
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
        // Raw only while this very line is being typed and the caret sits in
        // the tag — i.e. you are writing "/TODO" by hand. Never on navigation.
        const editing =
          typingLine === line.number &&
          sel.empty &&
          sel.head >= tagFrom &&
          sel.head <= tagTo;
        if (editing) {
          builder.add(tagFrom, tagTo, MARKS[state]);
        } else {
          const widget = Decoration.replace({ widget: new TodoBox(state) });
          builder.add(tagFrom, tagTo, widget);
          atomic.add(tagFrom, tagTo, widget);
        }
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
 * Backspace right after a checkbox removes the whole marker (and the space
 * that separated it from the text). The editor only skips an atomic range
 * when the caret is *inside* it, so without this the keystroke would eat the
 * tag's last letter, silently turning "/TODO" into text that no longer marks
 * anything.
 */
function deleteTagBackward(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  const tag = LINE_TAG.exec(line.text);
  if (!tag) return false;
  const from = line.from + tag[1].length;
  const to = from + 1 + tag[2].length;
  if (sel.head !== to) return false; // only immediately after the marker
  const hasSpace = line.text[tag[0].length] === " ";
  view.dispatch({
    changes: { from, to: to + (hasSpace ? 1 : 0) },
    userEvent: "delete",
  });
  return true;
}

export const todoKeymap = Prec.highest(
  keymap.of([
    { key: "Mod-Enter", run: rotateLine },
    { key: "Backspace", run: deleteTagBackward },
  ])
);

/** Line number the caret is on, or null if the document is empty. */
const caretLine = (view: EditorView) =>
  view.state.doc.lineAt(view.state.selection.main.head).number;

class TodoPlugin {
  decorations: DecorationSet;
  atomic: DecorationSet;
  /** The line currently being typed into, or null when merely navigating. */
  typingLine: number | null = null;

  constructor(view: EditorView) {
    const built = build(view, null);
    this.decorations = built.decorations;
    this.atomic = built.atomic;
  }

  update(u: ViewUpdate) {
    const typing = u.transactions.some(
      (tr) => tr.docChanged && !tr.isUserEvent("undo") && !tr.isUserEvent("redo")
    );
    const next = typing ? caretLine(u.view) : null;
    if (u.docChanged || u.viewportChanged || next !== this.typingLine) {
      this.typingLine = next;
      const built = build(u.view, next);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }
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
