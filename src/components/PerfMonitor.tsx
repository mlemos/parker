// Debug overlay (⌘⇧D) — live memory/CPU for the app + WebKit helper
// processes, plus webview-side health counters (DOM nodes, CodeMirror
// instances, buffer bytes). Samples every 2s while open; keeps a bounded
// history and draws a sparkline of the total footprint so growth is visible
// at a glance. The backend also logs one sample per minute to perf.jsonl
// independently of this overlay.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Buffer } from "../lib/layout";
import type { ThemeDef } from "../lib/themes";
import { latencyStats, resetLatency, runEditorBenchmark } from "../lib/latency";
import type { BenchRow, LatencyStats } from "../lib/latency";

interface ProcStats {
  pid: number;
  kind: string; // "app" | "WebContent" | "GPU" | "Networking"
  footprint: number;
  resident: number;
  cpu_ms: number;
}

interface PerfStats {
  app: ProcStats;
  helpers: ProcStats[];
  total_footprint: number;
  ts: number;
}

interface Sample {
  stats: PerfStats;
  domNodes: number;
  editors: number;
  cpuPct: number; // combined, since previous sample
}

const SAMPLE_MS = 2000;
const MAX_SAMPLES = 300; // 10 minutes of history

const fmtMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="perf-spark" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const w = 220;
  const h = 36;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="perf-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" strokeWidth="1.5" />
    </svg>
  );
}

export function PerfMonitor({
  buffers,
  theme,
  wrapOn,
  onClose,
}: {
  buffers: Buffer[];
  theme: ThemeDef;
  wrapOn: boolean;
  onClose: () => void;
}) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [logPath, setLogPath] = useState("");
  const [bench, setBench] = useState<BenchRow[] | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [lat, setLat] = useState<LatencyStats>(() => latencyStats());
  const prevRef = useRef<{ cpu: number; ts: number } | null>(null);

  useEffect(() => {
    invoke<string>("perf_log_path").then(setLogPath).catch(() => {});
  }, []);


  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      setLat(latencyStats());
      let stats: PerfStats;
      try {
        stats = await invoke<PerfStats>("perf_stats");
      } catch {
        return;
      }
      if (cancelled) return;
      const cpuNow =
        stats.app.cpu_ms + stats.helpers.reduce((s, h) => s + h.cpu_ms, 0);
      const prev = prevRef.current;
      const cpuPct = prev
        ? Math.max(0, ((cpuNow - prev.cpu) / (stats.ts - prev.ts)) * 100)
        : 0;
      prevRef.current = { cpu: cpuNow, ts: stats.ts };
      const sample: Sample = {
        stats,
        domNodes: document.getElementsByTagName("*").length,
        editors: document.querySelectorAll(".cm-editor").length,
        cpuPct,
      };
      setSamples((prev) => [...prev.slice(-(MAX_SAMPLES - 1)), sample]);
    };
    tick();
    const id = window.setInterval(tick, SAMPLE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const last = samples[samples.length - 1];
  const first = samples[0];
  const bufferBytes = buffers.reduce((s, b) => s + b.content.length, 0);
  const drift =
    last && first && samples.length > 5
      ? last.stats.total_footprint - first.stats.total_footprint
      : null;

  return (
    <div className="perf-monitor" role="dialog" aria-label="Performance monitor">
      <div className="perf-head">
        <span className="perf-title">Performance</span>
        <span className="perf-total">
          {last ? fmtMB(last.stats.total_footprint) : "…"}
        </span>
        <button className="perf-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <Sparkline
        values={samples.map((s) => s.stats.total_footprint)}
      />

      {last && (
        <>
          <table className="perf-table">
            <tbody>
              <tr>
                <td>app (pid {last.stats.app.pid})</td>
                <td>{fmtMB(last.stats.app.footprint)}</td>
              </tr>
              {last.stats.helpers.map((h) => (
                <tr key={h.pid}>
                  <td>
                    {h.kind} (pid {h.pid})
                  </td>
                  <td>{fmtMB(h.footprint)}</td>
                </tr>
              ))}
              <tr className="perf-row-dim">
                <td>CPU (all processes)</td>
                <td>{last.cpuPct.toFixed(1)}%</td>
              </tr>
              <tr className="perf-row-dim">
                <td>DOM nodes</td>
                <td>{last.domNodes}</td>
              </tr>
              <tr className="perf-row-dim">
                <td>CodeMirror editors</td>
                <td>{last.editors}</td>
              </tr>
              <tr className="perf-row-dim">
                <td>Buffers</td>
                <td>
                  {buffers.length} · {fmtMB(bufferBytes)}
                </td>
              </tr>
              {drift !== null && (
                <tr className={drift > 20_000_000 ? "perf-row-warn" : "perf-row-dim"}>
                  <td>Drift ({((samples.length * SAMPLE_MS) / 60000).toFixed(1)} min)</td>
                  <td>
                    {drift >= 0 ? "+" : ""}
                    {fmtMB(drift)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* Webview-side numbers: these don't need the backend, so they stay
          visible even if perf_stats is unavailable. */}
      <div className="perf-section">
        <span>Typing latency</span>
        <button
          className="perf-mini"
          onClick={() => {
            resetLatency();
            setLat(latencyStats());
          }}
        >
          reset
        </button>
      </div>
      <table className="perf-table">
        <tbody>
          <tr className={lat.p95 > 60 ? "perf-row-warn" : undefined}>
            <td>p50 / p95 / max</td>
            <td>
              {lat.n
                ? `${lat.p50.toFixed(0)} / ${lat.p95.toFixed(0)} / ${lat.max.toFixed(0)} ms`
                : "type to measure"}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="perf-section">
        <span>Benchmark</span>
        <button
          className="perf-mini"
          disabled={benchRunning}
          onClick={async () => {
            setBenchRunning(true);
            setBench(null);
            try {
              setBench(await runEditorBenchmark(theme, wrapOn));
            } finally {
              setBenchRunning(false);
            }
          }}
        >
          {benchRunning ? "running…" : "run"}
        </button>
      </div>
      {bench && (
        <table className="perf-table perf-bench">
          <tbody>
            {bench.map((r) => (
              <tr key={r.label} className={r.unit === "frame" && r.value > 20 ? "perf-row-warn" : undefined}>
                <td>{r.label}</td>
                <td>
                  {r.value.toFixed(1)} ms
                  <span className="perf-dim"> {r.unit}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {logPath && (
        <div className="perf-log" title={logPath}>
          1 sample/min → {logPath.replace(/^.*\//, "")}
        </div>
      )}
    </div>
  );
}
