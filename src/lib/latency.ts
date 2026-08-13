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
const samples: number[] = [];

/** Keys that change what's on screen. Modifiers alone repaint nothing. */
const MEASURED = /^(?:[\x20-\x7e]|Arrow|Page|Home|End|Backspace|Delete|Enter|Tab)/;

export interface LatencyStats {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function latencyStats(): LatencyStats {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 0.5),
    p95: percentile(s, 0.95),
    max: s.length ? s[s.length - 1] : 0,
  };
}

export function resetLatency() {
  samples.length = 0;
}

/** Start measuring keydown → painted frame. Returns a cleanup function. */
export function trackLatency(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || !MEASURED.test(e.key)) return;
    const t0 = performance.now();
    // First rAF runs before paint; the second one runs after the frame that
    // carried our change was composited.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        samples.push(performance.now() - t0);
        if (samples.length > MAX_SAMPLES) samples.shift();
      })
    );
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
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
 * mean interval between frames. Small edits always fit in a frame, so this
 * only says something when the operation repaints a large area — scrolling,
 * where a per-glyph text-shadow has to be redrawn for the whole viewport.
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
 * Benchmark the editor as configured, isolating the neon glow (a text-shadow
 * on every glyph) and the to-do decoration plugin. Runs on a throwaway editor
 * so no open note is touched; the host is on-screen so paint is real.
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
    noGlow: boolean,
    fn: (v: EditorView) => Promise<number>
  ) => {
    document.documentElement.classList.toggle("bench-noglow", noGlow);
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
      value: await withView(full, false, (v) => burst(typeOp(v), N)),
    });
    rows.push({
      label: "navigate ×40",
      unit: "js",
      value: await withView(full, false, (v) => burst(navOp(v), N)),
    });
    rows.push({
      label: "navigate · no to-dos",
      unit: "js",
      value: await withView(base, false, (v) => burst(navOp(v), N)),
    });

    // Paint cost: scrolling repaints everything, so the glow shows up here.
    rows.push({
      label: "scroll (frame)",
      unit: "frame",
      value: await withView(full, false, (v) => paced(scrollOp(v), 60)),
    });
    rows.push({
      label: "scroll · no glow",
      unit: "frame",
      value: await withView(full, true, (v) => paced(scrollOp(v), 60)),
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
    document.documentElement.classList.remove("bench-noglow");
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
