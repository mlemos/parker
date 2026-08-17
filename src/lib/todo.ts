// To-do rendering and interaction. Six states, one per leading slash tag:
//
//   /TODO   open       — empty box
//   /DOING  in progress — cyan box, dot           (/WIP = alias)
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
//   click     TODO/DOING/ATTN → DONE; DONE/FAIL/CANCEL → TODO (complete/reopen)
//   ⌥-click   TODO → DOING → ATTN → FAIL → CANCEL → TODO; DONE → ATTN
//   ⌘↩        rotate the line (Roam-style): no tag → /TODO → /DOING → /ATTN
//             → /DONE → /FAIL → /CANCEL → tag removed
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

const LINE_DECOS: Record<string, Decoration> = {
  DOING: Decoration.line({ class: "cm-todo-line-doing" }),
  WIP: Decoration.line({ class: "cm-todo-line-doing" }),
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
        : state === "DOING"
          ? "doing"
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
      if (kind === "doing") {
        // A stroked mark turns to mush at this size; a solid dot reads clean.
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", "12");
        dot.setAttribute("cy", "12");
        dot.setAttribute("r", "6.5");
        dot.setAttribute("fill", "currentColor");
        dot.setAttribute("stroke", "none");
        svg.appendChild(dot);
      } else {
        for (const d of GLYPH_PATHS[kind]) {
          const p = document.createElementNS(NS, "path");
          p.setAttribute("d", d);
          svg.appendChild(p);
        }
      }
      glyph.appendChild(svg);
    }
    box.appendChild(glyph);
    box.title =
      kind === "todo" || kind === "doing" || kind === "attn"
        ? "Mark done (⌥-click: cycle doing/attention/fail/cancel · ⌘↩ rotate)"
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

function build(view: EditorView): Built {
  const builder = new RangeSetBuilder<Decoration>();
  const atomic = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;

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
        const widget = Decoration.replace({ widget: new TodoBox(state) });
        builder.add(tagFrom, tagTo, widget);
        atomic.add(tagFrom, tagTo, widget);
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
