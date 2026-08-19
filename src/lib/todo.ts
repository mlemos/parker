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

/** State → the CSS/glyph name used for it. */
const KINDS: Record<string, string> = {
  TODO: "todo",
  DOING: "doing",
  PAUSE: "pause",
  WAIT: "wait",
  ATTN: "attn",
  DONE: "done",
  FAIL: "fail",
  CANCEL: "cancel",
};

/**
 * Every glyph is Lucide, verbatim, inlined as raw path data because the widget
 * is plain DOM (no React) — and drawn the way Lucide draws it: stroked
 * outline, round caps and joins, nothing filled.
 */
const GLYPH_PATHS: Record<string, string[]> = {
  // check — path spans y 6–17 (center 11.5), viewBox shifted to compensate
  done: ["M20 6 9 17l-5-5"],
  // x
  fail: ["M18 6 6 18", "m6 6 12 12"],
  // minus — the classic "dismissed / not applicable"
  cancel: ["M5 12h14"],
  // asterisk — "look at this one"
  attn: ["M12 6v12", "M17.196 9 6.804 15", "m6.804 9 10.392 6"],
  // play
  doing: [
    "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
  ],
  // hourglass — time passing, and not by your hand. The only glyph with
  // enough internal detail to need a thinner stroke (see STROKE).
  wait: [
    "M5 22h14",
    "M5 2h14",
    "M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22",
    "M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2",
  ],
};

/** One stroke weight for every glyph — a set of icons that disagree about line
    width stops looking like a set. It is heavier than Lucide's own 2 because
    the glyph renders at ~8px here, and no heavier than this because the
    shapes that enclose space (play, pause, hourglass, asterisk) close up. */
const STROKE = 2.5;

/**
 * Where each glyph's ink actually sits in Lucide's 24-unit grid — [x0,y0,x1,y1],
 * read off the path data above.
 *
 * Lucide draws every icon on the same grid but none of them fill it the same
 * way: the hourglass runs the full 20 units tall while the x spans 12, so at
 * this size the hourglass renders half again as big as the x sitting right
 * under it. Inside a checkbox that reads as sloppiness, not as variety. So each
 * glyph is scaled to put its longest side at the same length and centered on
 * the box — and the stroke is divided by that scale, so normalizing the size
 * does not un-normalize the line weight.
 */
const INK: Record<string, [number, number, number, number]> = {
  doing: [5, 3.27, 20.01, 20.73],
  pause: [5, 3, 19, 21],
  wait: [5, 2, 19, 22],
  attn: [6.8, 6, 17.2, 18],
  done: [4, 6, 20, 17],
  fail: [6, 6, 18, 18],
  cancel: [5, 12, 19, 12],
};

/** Units the longest side of every glyph ends up at, of the 24-unit grid. */
const INK_TARGET = 16;

/** The transform that lands a glyph's ink on INK_TARGET, centered, and the
    scale it used (the caller divides the stroke by it). */
function fit(kind: string): { transform: string; scale: number } {
  const [x0, y0, x1, y1] = INK[kind] ?? [0, 0, 24, 24];
  const scale = INK_TARGET / Math.max(x1 - x0, y1 - y0);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const tx = r(12 - (scale * (x0 + x1)) / 2);
  const ty = r(12 - (scale * (y0 + y1)) / 2);
  return { transform: `translate(${tx} ${ty}) scale(${r(scale)})`, scale };
}

/** Lucide `pause` — two rounded bars, stroked like the rest. */
const PAUSE_BARS: [number, number][] = [
  [5, 3],
  [14, 3],
];

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
    const kind = KINDS[state] ?? "cancel";
    box.className = `cm-todo-box cm-todo-box-${kind}`;
    // The visible square. Inner element so it can be drawn from the zero-height
    // anchor (see App.css) without nudging the line's baseline.
    const glyph = document.createElement("span");
    glyph.className = "cm-todo-glyph";
    if (kind !== "todo") {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      // Everything is drawn inside this group: it carries the size
      // normalization, and the stroke divided by that scale so the rendered
      // line weight comes out the same for every glyph.
      const { transform, scale } = fit(kind);
      const g = document.createElementNS(NS, "g");
      g.setAttribute("transform", transform);
      g.setAttribute("stroke-width", String(Math.round((STROKE / scale) * 1000) / 1000));
      svg.appendChild(g);
      if (kind === "pause") {
        for (const [x, y] of PAUSE_BARS) {
          const bar = document.createElementNS(NS, "rect");
          bar.setAttribute("x", String(x));
          bar.setAttribute("y", String(y));
          bar.setAttribute("width", "5");
          bar.setAttribute("height", "18");
          bar.setAttribute("rx", "1");
          g.appendChild(bar);
        }
      } else {
        for (const d of GLYPH_PATHS[kind]) {
          const p = document.createElementNS(NS, "path");
          p.setAttribute("d", d);
          g.appendChild(p);
        }
      }
      glyph.appendChild(svg);
    }
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
