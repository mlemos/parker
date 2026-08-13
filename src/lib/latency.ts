// Input-latency instrumentation for the ⌘⇧D overlay.
//
// Two tools, both running inside the app's own WebKit — the only place where
// paint costs are real (a browser benchmark would measure a different engine):
//
// - trackLatency(): passive. Times every editing/navigation keypress from the
//   keydown to the frame that actually painted its result, so the number is
//   what the fingers feel, not what the JS took.
// - runEditorBenchmark(): active A/B. Drives a throwaway editor built with the
//   real theme and extensions in bursts, and reports the JS cost and the time
//   the compositor then needs — with and without the factors we suspect. It
//   also measures the live editor (React path), restoring the note afterwards.

import { EditorState, EditorView, Prec } from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";
import { todoHighlighter, todoKeymap } from "./todo";
import { languageForName } from "./lang";
import type { ThemeDef } from "./themes";

// ---- The live editor -------------------------------------------------------

let activeView: EditorView | null = null;

/** EditorGroup registers its view here (onCreateEditor). */
export function setActiveView(view: EditorView) {
  activeView = view;
}
export const getActiveView = () => activeView;

// ---- Passive tracking ------------------------------------------------------

const MAX_SAMPLES = 240;
/** Time from the key event being created to our handler running (ms). */
const queued: number[] = [];
/** Time from our handler to the frame that painted the result (ms). */
const painted: number[] = [];

/** Keys that change what's on screen. Modifiers alone repaint nothing. */
const MEASURED = /^(?:[\x20-\x7e]|Arrow|Page|Home|End|Backspace|Delete|Enter|Tab)/;

export interface LatencyStats {
  n: number;
  p50: number;
  p95: number;
  max: number;
  /** Median of the two halves: waiting to be delivered vs. rendering. */
  queue: number;
  paint: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function latencyStats(): LatencyStats {
  const total = queued.map((q, i) => q + (painted[i] ?? 0)).sort((a, b) => a - b);
  const q = [...queued].sort((a, b) => a - b);
  const p = [...painted].sort((a, b) => a - b);
  return {
    n: total.length,
    p50: percentile(total, 0.5),
    p95: percentile(total, 0.95),
    max: total.length ? total[total.length - 1] : 0,
    queue: percentile(q, 0.5),
    paint: percentile(p, 0.5),
  };
}

export function resetLatency() {
  queued.length = 0;
  painted.length = 0;
}

/** Start measuring keydown → painted frame. Returns a cleanup function. */
export function trackLatency(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || !MEASURED.test(e.key)) return;
    const t0 = performance.now();
    // e.timeStamp is when WebKit created the event, on the same clock as
    // performance.now() — so this is how long the key waited to reach us.
    // A busy main thread shows up here and nowhere else.
    const wait = e.timeStamp > 0 ? Math.max(0, t0 - e.timeStamp) : 0;
    // First rAF runs before paint; the second one runs after the frame that
    // carried our change was composited.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        queued.push(wait);
        painted.push(performance.now() - t0);
        if (queued.length > MAX_SAMPLES) {
          queued.shift();
          painted.shift();
        }
      })
    );
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}

// ---- Tab switching ---------------------------------------------------------

const tabSwitches: number[] = [];

/**
 * Time a tab switch from the click/shortcut to the frame that shows the new
 * note. Switching remounts the editor today, so this is where the hitch that
 * per-keystroke latency can't explain would appear.
 */
export function markTabSwitch() {
  const t0 = performance.now();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      tabSwitches.push(performance.now() - t0);
      if (tabSwitches.length > 40) tabSwitches.shift();
    })
  );
}

export function tabSwitchStats() {
  const s = [...tabSwitches].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 0.5),
    max: s.length ? s[s.length - 1] : 0,
  };
}

// ---- Active benchmark ------------------------------------------------------

export interface BenchRow {
  label: string;
  /** Milliseconds — meaning depends on `unit`. */
  value: number;
  /** "js" = time for 40 operations; "frame" = mean frame interval under load
      (16.7 ms means the compositor kept up at 60fps). */
  unit: "js" | "frame";
}

/** Next animation frame — but never hang: WebKit suspends rAF while the
    window is occluded, and a benchmark that waits forever is worse than one
    that reports a bad number. The timeout also marks the sample unreliable. */
let framesTimedOut = 0;
const nextFrame = () =>
  new Promise<number>((r) => {
    let done = false;
    const finish = (t: number, viaTimeout: boolean) => {
      if (done) return;
      done = true;
      if (viaTimeout) framesTimedOut++;
      r(t);
    };
    requestAnimationFrame((t) => finish(t, false));
    setTimeout(() => finish(performance.now(), true), 250);
  });

const DOC = Array.from(
  { length: 120 },
  (_, i) =>
    i % 7 === 0
      ? `## section ${i}`
      : i % 5 === 0
        ? `/TODO item ${i} with a bit of text to lay out`
        : `line ${i} — some prose with \`code\` and **bold** to give the highlighter work`
).join("\n");

/**
 * Run `n` operations back to back, then wait for the frame that paints them.
 * Pacing one op per frame (the obvious design) is useless here: everything
 * fits in a frame, so every variant reports exactly one frame interval. A
 * burst separates the JS cost from what the compositor then has to do.
 */
async function burst(op: (i: number) => void, n: number): Promise<number> {
  await nextFrame();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) op(i);
  return performance.now() - t0;
}

/**
 * Sustained-load test: one operation per frame for `n` frames, reporting the
 * median interval between frames. Small edits always fit in a frame, so this
 * only says something when the operation repaints a large area — scrolling.
 */
async function paced(op: (i: number) => void, n: number): Promise<number> {
  let prev = await nextFrame();
  const deltas: number[] = [];
  for (let i = 0; i < n; i++) {
    op(i);
    const t = await nextFrame();
    deltas.push(t - prev);
    prev = t;
  }
  deltas.sort((a, b) => a - b); // median: robust to a stray long frame
  return deltas[Math.floor(deltas.length / 2)];
}

/** Type a character at the end of a line, cycling through lines. */
const typeOp = (view: EditorView) => (i: number) => {
  const line = view.state.doc.line((i % 60) + 20);
  view.dispatch({
    changes: { from: line.to, insert: "x" },
    selection: { anchor: line.to + 1 },
    userEvent: "input.type",
  });
};

/** Move the cursor to another line — no document change, pure navigation. */
const navOp = (view: EditorView) => (i: number) => {
  const line = view.state.doc.line((i % 80) + 10);
  view.dispatch({ selection: { anchor: line.from } });
};

/** Scroll a few pixels — forces the whole viewport to be repainted. */
const scrollOp = (view: EditorView) => (i: number) => {
  view.scrollDOM.scrollTop = (i * 9) % 400;
};

/**
 * Benchmark the editor as configured: the JS cost of editing and navigating,
 * the frame interval under continuous scrolling (where paint shows up), and
 * the live editor's React round-trip. Runs on a throwaway editor so no open
 * note is touched; its host is on-screen so paint is real.
 */
export async function runEditorBenchmark(
  theme: ThemeDef,
  wrapOn: boolean
): Promise<BenchRow[]> {
  framesTimedOut = 0;
  const host = document.createElement("div");
  host.className = "editor-wrap bench-host";
  document.body.appendChild(host);

  const lang = await languageForName("bench.md");
  const base: Extension[] = [
    Prec.highest(theme.cm),
    ...(wrapOn ? [EditorView.lineWrapping] : []),
    ...lang,
  ];

  const rows: BenchRow[] = [];
  const N = 40;

  const withView = async (
    extensions: Extension[],
    fn: (v: EditorView) => Promise<number>
  ) => {
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions }),
      parent: host,
    });
    await nextFrame();
    const out = await fn(view);
    view.destroy();
    return out;
  };

  const full = [...base, todoHighlighter, todoKeymap];
  try {
    // JS cost of the editor's own work.
    rows.push({
      label: "type ×40",
      unit: "js",
      value: await withView(full, (v) => burst(typeOp(v), N)),
    });
    rows.push({
      label: "navigate ×40",
      unit: "js",
      value: await withView(full, (v) => burst(navOp(v), N)),
    });
    rows.push({
      label: "navigate · no to-dos",
      unit: "js",
      value: await withView(base, (v) => burst(navOp(v), N)),
    });

    // Paint cost: scrolling repaints the whole viewport every frame.
    rows.push({
      label: "scroll (frame)",
      unit: "frame",
      value: await withView(full, (v) => paced(scrollOp(v), 60)),
    });

    // The path the fingers actually take: the live editor, so React's
    // re-render and the autosave scheduling are inside the measurement.
    const live = getActiveView();
    if (live) {
      const before = live.state.doc.toString();
      const at = live.state.selection.main.head;
      const insert = () =>
        live.dispatch({
          changes: { from: live.state.selection.main.head, insert: "x" },
          selection: { anchor: live.state.selection.main.head + 1 },
          userEvent: "input.type",
        });
      rows.push({
        label: "type ×40 · live (React)",
        unit: "js",
        value: await burst(insert, N),
      });
      live.dispatch({
        changes: { from: 0, to: live.state.doc.length, insert: before },
        selection: { anchor: Math.min(at, before.length) },
      });
    }
  } finally {
    host.remove();
  }
  if (framesTimedOut)
    rows.push({
      label: "⚠︎ window occluded — frame numbers unreliable",
      value: 0,
      unit: "frame",
    });
  return rows;
}
