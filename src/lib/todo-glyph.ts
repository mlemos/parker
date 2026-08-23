// The to-do icons, as markup rather than as DOM.
//
// Two renderers draw these now: the editor's CodeMirror widget and the
// markdown preview, which builds an HTML string and has no document to call
// createElementNS on. Geometry this fussy — normalised ink size, stroke
// divided by the scale that normalised it — must not exist twice, so it lives
// here and both sides ask for the same string.

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

/** Escape for an attribute value. The inputs here are our own constants, but
 *  this markup is concatenated into a document and must not depend on that. */
const attr = (v: string | number): string =>
  String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The glyph name for a state (already normalised), or "cancel" if unknown. */
export const kindOf = (state: string): string => KINDS[state] ?? "cancel";

/**
 * The `<svg>` for a state's glyph, as a string. Empty for TODO: the open state
 * is an empty box, and drawing nothing in it is the point.
 */
export function todoGlyphSvg(kind: string): string {
  if (kind === "todo") return "";
  const { transform, scale } = fit(kind);
  const width = Math.round((STROKE / scale) * 1000) / 1000;
  const shapes =
    kind === "pause"
      ? PAUSE_BARS.map(
          ([x, y]) =>
            `<rect x="${attr(x)}" y="${attr(y)}" width="5" height="18" rx="1"/>`
        ).join("")
      : (GLYPH_PATHS[kind] ?? []).map((d) => `<path d="${attr(d)}"/>`).join("");
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-linecap="round" stroke-linejoin="round">` +
    `<g transform="${attr(transform)}" stroke-width="${attr(width)}">${shapes}</g>` +
    `</svg>`
  );
}

/**
 * The whole box for a state: the square, and the glyph inside it.
 *
 * Deliberately the same class names the editor's widget builds, so the one set
 * of rules in App.css dresses both. Two sets that have to be kept in step is
 * how a preview slowly stops looking like the editor.
 */
export function todoBoxHtml(state: string): string {
  const kind = kindOf(state);
  return (
    `<span class="cm-todo-box cm-todo-box-${attr(kind)}" aria-hidden="true">` +
    `<span class="cm-todo-glyph">${todoGlyphSvg(kind)}</span></span>`
  );
}
