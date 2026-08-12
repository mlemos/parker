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
// ordinary edit. When the cursor is on the line the tag shows as raw text
// (highlighted) so it can be edited like anything else. Color carries the
// state — never a strikethrough.
//
// Interactions:
//   click     TODO/ATTN → DONE; DONE/FAIL/CANCEL → TODO (complete / reopen)
//   ⌥-click   TODO → ATTN → FAIL → CANCEL → TODO; DONE → ATTN
//   ⌘↩        rotate the cursor line (Roam-style):
//             no tag → /TODO → /ATTN → /DONE → /FAIL → /CANCEL → tag removed
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

/** Slash tag at the start of a line (after optional indent). */
const LINE_TAG = /^(\s*)\/(TODO|ATTN|DONE|FAIL|MISSED|CANCEL|DISMISSED)(?=\s|$)/;

/** ⌘↩ rotation order. MISSED/DISMISSED normalize on any interaction. */
const ORDER = ["TODO", "ATTN", "DONE", "FAIL", "CANCEL"] as const;

const norm = (s: string) =>
  s === "MISSED" ? "FAIL" : s === "DISMISSED" ? "CANCEL" : s;

/** Raw-tag highlight while the cursor is on the line. */
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

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc, selection } = view.state;
  const cursorLine = doc.lineAt(selection.main.head).number;

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
        if (line.number === cursorLine) {
          // Cursor here: show the raw tag (highlighted) so it's editable.
          builder.add(tagFrom, tagTo, MARKS[state]);
        } else {
          builder.add(
            tagFrom,
            tagTo,
            Decoration.replace({ widget: new TodoBox(state) })
          );
        }
      }

      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** Rewrite the tag on `line` to `next` (null removes it, incl. one trailing space). */
function writeTag(
  view: EditorView,
  line: { from: number; text: string },
  tag: RegExpExecArray,
  next: string | null
) {
  const from = line.from + tag[1].length;
  const tagEnd = from + 1 + tag[2].length;
  if (next) {
    view.dispatch({
      changes: { from, to: tagEnd, insert: "/" + next },
      userEvent: "input",
    });
  } else {
    const hasSpace = line.text[tag[0].length] === " ";
    view.dispatch({
      changes: { from, to: tagEnd + (hasSpace ? 1 : 0) },
      userEvent: "delete",
    });
  }
}

/** Checkbox click: complete/reopen; ⌥ cycles the attention/cancel states. */
function toggle(view: EditorView, pos: number, alt: boolean): boolean {
  const line = view.state.doc.lineAt(pos);
  const tag = LINE_TAG.exec(line.text);
  if (!tag) return false;
  const cur = norm(tag[2]);
  const next = alt
    ? cur === "TODO"
      ? "ATTN"
      : cur === "ATTN"
        ? "FAIL"
        : cur === "FAIL"
          ? "CANCEL"
          : cur === "CANCEL"
            ? "TODO"
            : "ATTN" // DONE → needs another look
    : cur === "TODO" || cur === "ATTN"
      ? "DONE"
      : "TODO";
  writeTag(view, line, tag, next);
  return true;
}

/** ⌘↩ — rotate the cursor line through the four states (Roam-style). */
function rotateLine(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const tag = LINE_TAG.exec(line.text);
  if (!tag) {
    const indent = /^\s*/.exec(line.text)![0];
    view.dispatch({
      changes: { from: line.from + indent.length, insert: "/TODO " },
      userEvent: "input",
    });
    return true;
  }
  const idx = ORDER.indexOf(norm(tag[2]) as (typeof ORDER)[number]);
  const next = idx + 1 < ORDER.length ? ORDER[idx + 1] : null;
  writeTag(view, line, tag, next);
  return true;
}

export const todoKeymap = Prec.highest(
  keymap.of([{ key: "Mod-Enter", run: rotateLine }])
);

export const todoHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet)
        this.decorations = build(u.view);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        const box = (e.target as HTMLElement).closest?.(".cm-todo-box");
        if (!box) return false;
        e.preventDefault();
        return toggle(view, view.posAtDOM(box), e.altKey);
      },
    },
  }
);
