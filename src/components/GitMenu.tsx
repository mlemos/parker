import { useCallback, useEffect, useRef, useState } from "react";
import { GitBranch, Loader2, CloudUpload } from "lucide-react";
import { api } from "../lib/api";
import type { GitStatus, GitFileChange, GitLogEntry } from "../lib/api";

const POLL_MS = 15000;

// A smart default commit message from the changed notes (the folder is flat).
function suggestMessage(files: GitFileChange[]): string {
  if (files.length === 0) return "";
  const base = (p: string) => p.split("/").pop() || p;
  const names = files.map((f) => base(f.path));
  if (names.length === 1) return `Update ${names[0]}`;
  if (names.length <= 3) return `Update ${names.join(", ")}`;
  return `Update ${names.length} notes`;
}

// Turn a git remote URL into a friendly "host/owner/repo" label.
function prettyRemote(url: string | null): string {
  if (!url) return "";
  const s = url.trim().replace(/\.git$/, "");
  const scp = s.match(/^[^@]+@([^:]+):(.+)$/); // git@github.com:owner/repo
  if (scp) return `${scp[1]}/${scp[2]}`;
  const m = s.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i); // https://…
  if (m) return `${m[1]}/${m[2]}`;
  return s;
}

function fileKind(status: string): { label: string; cls: string } {
  const t = status.trim();
  if (t === "??") return { label: "new", cls: "gm-add" };
  if (t.startsWith("A")) return { label: "added", cls: "gm-add" };
  if (t.startsWith("D")) return { label: "del", cls: "gm-del" };
  if (t.startsWith("R")) return { label: "moved", cls: "gm-mod" };
  return { label: "mod", cls: "gm-mod" };
}

function IconGit({ spin }: { spin?: boolean }) {
  return spin ? (
    <Loader2 className="gm-icon spin" size={12} strokeWidth={2} aria-hidden="true" />
  ) : (
    <GitBranch className="gm-icon" size={12} strokeWidth={2} aria-hidden="true" />
  );
}

function IconCloud() {
  return (
    <CloudUpload className="gm-cloud" size={13} strokeWidth={2} aria-hidden="true" />
  );
}

export function GitMenu({
  onBeforeCommit,
}: {
  onBeforeCommit: () => Promise<void>;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Keep refresh's message-prefill decision current without re-subscribing.
  const editedRef = useRef(edited);
  editedRef.current = edited;

  const refresh = useCallback(async () => {
    try {
      const s = await api.gitStatus();
      setStatus(s);
      if (!editedRef.current && s.is_repo) {
        setMessage(suggestMessage(s.files));
      }
    } catch {
      setStatus(null);
    }
  }, []);

  const refreshLog = useCallback(async () => {
    try {
      setLog(await api.gitLog(25));
    } catch {
      setLog([]);
    }
  }, []);

  // Initial load + light polling + refresh on window focus.
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const files = status?.files ?? [];
  const count = files.length;
  const ahead = status?.ahead ?? -1;
  const hasRemote = status?.has_remote ?? false;
  const hasUpstream = ahead >= 0;
  const clean = count === 0 && (!hasUpstream || ahead === 0);

  const runCommit = useCallback(
    async (push: boolean) => {
      setError(null);
      setOkFlash(null);
      const s = status;
      const pending = s?.files.length ?? 0;
      setBusy(true);
      try {
        await onBeforeCommit(); // flush the latest keystrokes to disk first
        // Push-only: clean tree but unpushed commits exist.
        if (push && pending === 0) {
          const r = await api.gitPush();
          if (!r.ok) {
            setError(r.error ?? "Push failed.");
            return;
          }
          setOkFlash(r.message || "Pushed");
        } else {
          const msg = message.trim();
          if (!msg) {
            setError("Write a commit message first.");
            return;
          }
          const r = await api.gitCommit(msg, push);
          if (!r.ok) {
            setError(r.error ?? "Commit failed.");
            return;
          }
          setOkFlash(
            `${r.message}${r.hash ? ` · ${r.hash}` : ""}`.trim()
          );
          setMessage("");
          setEdited(false);
        }
        await refresh();
        await refreshLog();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [status, message, onBeforeCommit, refresh, refreshLog]
  );

  // Cmd+Shift+S — quick commit & push using whatever message is prefilled.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (status?.is_repo) runCommit(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, runCommit]);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!status?.is_repo) return null;

  const toggleOpen = () => {
    setError(null);
    setOkFlash(null);
    const next = !open;
    setOpen(next);
    if (next) {
      refresh();
      refreshLog();
    }
  };

  const badge =
    count > 0 ? `${count}` : hasUpstream && ahead > 0 ? `↑${ahead}` : "";
  const chipTitle = clean
    ? "Everything committed"
    : count > 0
      ? `${count} change${count === 1 ? "" : "s"} to commit`
      : `${ahead} commit${ahead === 1 ? "" : "s"} to push`;

  const canCommit = count > 0 && !!message.trim() && !busy;
  const canCommitPush =
    !busy &&
    hasRemote &&
    ((count > 0 && !!message.trim()) || (count === 0 && ahead > 0));
  const pushOnly = count === 0 && ahead > 0;

  return (
    <div className="gm-root" ref={rootRef}>
      <button
        className={"status-git" + (clean ? "" : " dirty") + (open ? " open" : "")}
        onClick={toggleOpen}
        title={
          hasRemote
            ? `${chipTitle} · backs up to ${prettyRemote(status.remote_url)}`
            : `${chipTitle} · local only (no remote backup)`
        }
      >
        <IconGit spin={busy} />
        <span className="git-label">
          {status.branch ?? "git"}
          {badge && <span className="gm-badge">{badge}</span>}
        </span>
        {hasRemote ? (
          <IconCloud />
        ) : (
          <span className="gm-local">local</span>
        )}
      </button>

      {open && (
        <div className="gm-pop" role="dialog" aria-label="Git">
          <div className="gm-head">
            <span className="gm-branch">{status.branch ?? "—"}</span>
            <span className="gm-sync">
              {!hasUpstream
                ? hasRemote
                  ? "no upstream"
                  : "local only"
                : ahead === 0
                  ? "in sync"
                  : `↑${ahead} to push`}
            </span>
            {count > 0 && (
              <span className="gm-totals">
                <span className="gm-add">+{status.total_added}</span>{" "}
                <span className="gm-del">−{status.total_deleted}</span>
              </span>
            )}
          </div>

          {/* Destination — where a push goes, or that it's local-only */}
          <div className={"gm-dest" + (hasRemote ? "" : " local")}>
            {hasRemote ? (
              <>
                <IconCloud />
                <span className="gm-dest-label">
                  Backs up to <strong>{prettyRemote(status.remote_url)}</strong>
                </span>
              </>
            ) : (
              <span className="gm-dest-label">
                Local only — no remote yet. <code>git remote add origin …</code>{" "}
                to back up to GitHub.
              </span>
            )}
          </div>

          {/* Pending changes */}
          <div className="gm-section">
            {count === 0 ? (
              <div className="gm-empty">
                {pushOnly ? "Clean tree — commits ready to push." : "Nothing to commit."}
              </div>
            ) : (
              <ul className="gm-files">
                {files.map((f) => {
                  const k = fileKind(f.status);
                  return (
                    <li key={f.path} className="gm-file" title={f.path}>
                      <span className={"gm-tag " + k.cls}>{k.label}</span>
                      <span className="gm-path">{f.path}</span>
                      <span className="gm-delta">
                        {f.binary ? (
                          <span className="gm-bin">bin</span>
                        ) : (
                          <>
                            {f.added > 0 && (
                              <span className="gm-add">+{f.added}</span>
                            )}
                            {f.added > 0 && f.deleted > 0 ? " " : ""}
                            {f.deleted > 0 && (
                              <span className="gm-del">−{f.deleted}</span>
                            )}
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Commit form */}
          {(count > 0 || pushOnly) && (
            <div className="gm-form">
              {!pushOnly && (
                <input
                  className="gm-msg"
                  type="text"
                  value={message}
                  spellCheck={false}
                  placeholder="Commit message…"
                  disabled={busy}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setEdited(true);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && (e.metaKey || !e.shiftKey)) {
                      e.preventDefault();
                      if (canCommitPush) runCommit(true);
                      else if (canCommit) runCommit(false);
                    }
                  }}
                />
              )}
              <div className="gm-actions">
                {!pushOnly && (
                  <button
                    className="gm-btn"
                    onClick={() => runCommit(false)}
                    disabled={!canCommit}
                  >
                    Commit
                  </button>
                )}
                <button
                  className="gm-btn primary"
                  onClick={() => runCommit(true)}
                  disabled={!canCommitPush}
                  title={!hasRemote ? "No remote configured" : ""}
                >
                  {pushOnly ? "Push" : "Commit & Push"}
                </button>
              </div>
              {!hasRemote && (
                <div className="gm-hint">
                  No remote — add an <code>origin</code> to push.
                </div>
              )}
            </div>
          )}

          {error && <div className="gm-error">{error}</div>}
          {okFlash && <div className="gm-ok">{okFlash}</div>}

          {/* History */}
          {log.length > 0 && (
            <div className="gm-history">
              <div className="gm-history-head">History</div>
              <ul className="gm-log">
                {log.map((c) => (
                  <li
                    key={c.hash}
                    className={"gm-commit" + (c.unpushed ? " unpushed" : "")}
                    title={`${c.hash} · ${c.rel_date}${c.unpushed ? " · not pushed" : ""}`}
                  >
                    <span className="gm-dot" aria-hidden />
                    <code className="gm-hash">{c.hash}</code>
                    <span className="gm-subject">{c.subject}</span>
                    <span className="gm-when">{c.rel_date}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
