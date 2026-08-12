// To-do rendering. Two layers:
//
// 1. A slash tag at the start of a line (/TODO, /DONE, /CANCEL — /FAIL is a
//    legacy alias) renders as a clickable checkbox widget in place of the tag.
//    Click toggles TODO ↔ DONE; Option-click marks CANCEL. The document stays
//    plain text — the widget just replaces the tag visually, and clicking it
//    rewrites the tag through a normal editor transaction (so autosave and
//    git sync see an ordinary edit). When the cursor is on the line the tag
//    shows as raw text (highlighted) so it can be edited like anything else.
//    DONE lines go green, CANCEL lines red — color, no strikethrough.
//
// Bare TODO/DONE elsewhere in the text is left alone (a #tag chip system may
// come later). This is a plain decoration pass over the visible range — no
// parser — so it works in every file type and layers on top of the theme.
import {
  Decoration,
  EditorView,
  ViewPlugin,
  RangeSetBuilder,
  WidgetType,
} from "@uiw/react-codemirror";
import type { DecorationSet, ViewUpdate } from "@uiw/react-codemirror";

/** Slash tag at the start of a line (after optional indent). */
const LINE_TAG = /^(\s*)\/(TODO|DONE|CANCEL|FAIL)(?=\s|$)/;

/** Raw-tag highlight while the cursor is on the line. */
const MARKS: Record<string, Decoration> = {
  TODO: Decoration.mark({ class: "cm-todo cm-todo-todo" }),
  DONE: Decoration.mark({ class: "cm-todo cm-todo-done" }),
  FAIL: Decoration.mark({ class: "cm-todo cm-todo-fail" }),
  CANCEL: Decoration.mark({ class: "cm-todo cm-todo-fail" }),
};

const DONE_LINE = Decoration.line({ class: "cm-todo-line-done" });
const CANCEL_LINE = Decoration.line({ class: "cm-todo-line-cancel" });

class TodoBox extends WidgetType {
  constructor(readonly state: string) {
    super();
  }
  eq(other: TodoBox) {
    return other.state === this.state;
  }
  toDOM() {
    const box = document.createElement("span");
    const kind = this.state === "TODO" ? "todo" : this.state === "DONE" ? "done" : "cancel";
    box.className = `cm-todo-box cm-todo-box-${kind}`;
    // Inner span so the glyph can be scaled down without shrinking the box's
    // em-based size, and flex-centered without nudging the line's baseline.
    const glyph = document.createElement("span");
    glyph.className = "cm-todo-glyph";
    glyph.textContent = kind === "done" ? "✓" : kind === "cancel" ? "✕" : "";
    box.appendChild(glyph);
    box.title =
      kind === "todo"
        ? "Mark done (⌥-click: cancel)"
        : kind === "done"
          ? "Back to to-do (⌥-click: cancel)"
          : "Back to to-do";
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
        if (state === "DONE") builder.add(line.from, line.from, DONE_LINE);
        else if (state !== "TODO") builder.add(line.from, line.from, CANCEL_LINE);
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

/** Cycle the tag under a clicked checkbox and write it back into the text. */
function toggle(view: EditorView, pos: number, alt: boolean): boolean {
  const line = view.state.doc.lineAt(pos);
  const tag = LINE_TAG.exec(line.text);
  if (!tag) return false;
  const cur = tag[2];
  const canceled = cur === "CANCEL" || cur === "FAIL";
  const next = alt
    ? canceled
      ? "TODO"
      : "CANCEL"
    : cur === "TODO"
      ? "DONE"
      : "TODO";
  const from = line.from + tag[1].length;
  view.dispatch({
    changes: { from, to: from + 1 + cur.length, insert: "/" + next },
  });
  return true;
}

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
