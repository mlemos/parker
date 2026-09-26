// The first open on a Mac (Onda 5): where your notes will live.
//
// Parker used to make ~/Documents/Parker in silence, and macOS's Documents
// prompt arrived out of nowhere. Now it says hello first, looks in Documents ›
// Parker only when asked to (so the prompt comes explained, and "Don't Allow"
// is a path, not a dead end), shows what it found — notes, iCloud, git — and
// then one screen that explains the choice: where the folder is, whether it
// syncs, and what to do on the iPhone. Nothing is created until Continue.
//
// Screens and words follow the prototype approved on 24/09 ("Parker Mac First
// Run"); the sentences themselves live in lib/first-run.ts, tested.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  afterLook,
  contentsLine,
  gitLine,
  icloudLine,
  iphoneLine,
  recommendDocuments,
  stateLine,
  syncLine,
} from "../lib/first-run";
import type { FolderInfo, ICloudState, Tone } from "../lib/first-run";

/** What the screen needs from the outside: the app passes the real commands,
 *  the harness and the tests a fake. */
export interface FirstRunBackend {
  lookForNotes(): Promise<FolderInfo>;
  inspect(path: string): Promise<FolderInfo>;
  icloud(): Promise<ICloudState>;
  /** The Open panel; null when cancelled. */
  pickFolder(): Promise<string | null>;
  openSystemSettings(pane: "icloud" | "privacy"): Promise<void>;
  /** Make the folder if need be and use it; the note to open, if one was made. */
  finish(path: string): Promise<string | null>;
}

type Screen = "look" | "denied" | "found" | "create" | "confirm";

const Mark = ({ tone, children }: { tone: Tone | "none"; children: ReactNode }) => (
  <span className={`fr-mark fr-${tone}`}>{children}</span>
);

function Logo() {
  return (
    <div className="fr-logo">
      <b>P</b>Parker
    </div>
  );
}

function FolderCard({ f, sub }: { f: FolderInfo; sub: string }) {
  return (
    <div className="fr-card">
      <div className="fr-folder" aria-hidden />
      <div>
        <div className="fr-card-title">
          {f.display} <span className="fr-tag">suggested</span>
        </div>
        <div className="fr-card-sub">{sub}</div>
        <div className="fr-path">{f.path}</div>
      </div>
    </div>
  );
}

/** Screen 1's x-ray of the suggested folder: contents, iCloud, git. */
function XRay({ f, icloud }: { f: FolderInfo; icloud: ICloudState }) {
  const ic = icloudLine(f, icloud);
  const git = gitLine(f);
  return (
    <div className="fr-xray">
      <div className="fr-xr">
        <span className="fr-k">Contents</span>
        <Mark tone={f.exists && (f.notes || f.other) ? "ok" : "none"}>{contentsLine(f)}</Mark>
      </div>
      <div className="fr-xr">
        <span className="fr-k">iCloud</span>
        <Mark tone={ic.tone}>{ic.text}</Mark>
      </div>
      <div className="fr-xr">
        <span className="fr-k">Git</span>
        <Mark tone={git.tone}>{f.git ? `Git repository${f.git_remote ? ` · ${f.git_remote}` : ""}` : f.exists ? "Not a git repository" : "—"}</Mark>
      </div>
    </div>
  );
}

export function FirstRun({ backend, onDone }: { backend: FirstRunBackend; onDone: (note: string | null) => void }) {
  const [screen, setScreen] = useState<Screen>("look");
  const [suggested, setSuggested] = useState<FolderInfo | null>(null);
  const [choice, setChoice] = useState<FolderInfo | null>(null);
  const [icloud, setIcloud] = useState<ICloudState>({ drive: false, documents: false });
  const [from, setFrom] = useState<Screen>("look");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const look = () =>
    run(async () => {
      const [f, ic] = await Promise.all([backend.lookForNotes(), backend.icloud()]);
      setSuggested(f);
      setIcloud(ic);
      setScreen(afterLook(f));
    });

  const pick = (back: Screen) =>
    run(async () => {
      const path = await backend.pickFolder();
      if (!path) return;
      const [f, ic] = await Promise.all([backend.inspect(path), backend.icloud()]);
      setIcloud(ic);
      setChoice(f);
      setFrom(back);
      setUpdated(false);
      setScreen("confirm");
    });

  const useSuggested = (back: Screen) => {
    if (!suggested) return;
    setChoice(suggested);
    setFrom(back);
    setUpdated(false);
    setScreen("confirm");
  };

  // Back from System Settings: what it changed shows here by itself.
  const refresh = useCallback(async () => {
    if (screen !== "confirm" || !choice) return;
    const [f, ic] = await Promise.all([backend.inspect(choice.path), backend.icloud()]);
    if (!icloud.documents && ic.documents) setUpdated(true);
    setIcloud(ic);
    setChoice(f);
  }, [backend, choice, icloud.documents, screen]);

  useEffect(() => {
    const onFocus = () => {
      refresh().catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const finish = () =>
    run(async () => {
      if (!choice) return;
      onDone(await backend.finish(choice.path));
    });

  const isSuggested = !!choice && !!suggested && choice.path === suggested.path;

  return (
    <div className="fr" role="main" aria-label="Welcome to Parker">
      <div className="fr-drag" data-tauri-drag-region />
      <div className="fr-body">
        <Logo />
        {screen === "look" && (
          <>
            <h1>Hi, I'm Parker.</h1>
            <p className="fr-lead">
              Your notes are plain Markdown files in one folder — yours, readable by any app and any AI agent. Let's find them first: I'll look in{" "}
              <b>Documents › Parker</b>.
            </p>
            <p className="fr-lead">macOS will ask whether I may look in your Documents folder.</p>
            <div className="fr-btns">
              <button className="fr-link" disabled={busy} onClick={() => pick("look")}>
                Choose a folder myself instead
              </button>
              <span className="fr-grow" />
              <button className="fr-btn fr-pri" disabled={busy} onClick={look}>
                {busy ? "Looking…" : "Look in Documents"}
              </button>
            </div>
          </>
        )}

        {screen === "denied" && (
          <>
            <h1>No worries.</h1>
            <p className="fr-lead">I won't look in Documents. Choose where your notes should live instead — any folder works.</p>
            <p className="fr-lead fr-small">
              To use Documents › Parker later, allow it in System Settings › Privacy &amp; Security › Files &amp; Folders › Parker, then look again.
            </p>
            <div className="fr-btns">
              <button className="fr-btn" disabled={busy} onClick={() => backend.openSystemSettings("privacy").catch(() => {})}>
                Open Privacy Settings
              </button>
              <button className="fr-btn" disabled={busy} onClick={look}>
                Look again
              </button>
              <span className="fr-grow" />
              <button className="fr-btn fr-pri" disabled={busy} onClick={() => pick("denied")}>
                Choose a folder…
              </button>
            </div>
          </>
        )}

        {(screen === "found" || screen === "create") && suggested && (
          <>
            <h1>{screen === "found" ? "Nice — your notes are right here." : "Fresh start."}</h1>
            <p className="fr-lead">{screen === "found" ? "Right where I'd keep them." : "No notes yet — I'll make them a home, right here."}</p>
            <FolderCard
              f={suggested}
              sub={screen === "found" ? contentsLine(suggested) : "A new folder, with a Welcome note to start."}
            />
            <XRay f={suggested} icloud={icloud} />
            {screen === "create" && icloud.documents && (
              // A new Mac, iCloud still bringing the files over: creating now
              // would make iCloud keep both, as "Parker 2" (stress test, 24/09).
              <p className="fr-hint">
                Used Parker on another Mac or on an iPhone? iCloud may still be bringing that folder here.{" "}
                <button className="fr-link" disabled={busy} onClick={look}>
                  Look again
                </button>
              </p>
            )}
            <div className="fr-btns">
              <button className="fr-link" disabled={busy} onClick={() => pick(screen)}>
                Create or select another folder…
              </button>
              <span className="fr-grow" />
              <button className="fr-btn fr-pri" disabled={busy} onClick={() => useSuggested(screen)}>
                {screen === "found" ? "Use this folder" : "Create it"}
              </button>
            </div>
          </>
        )}

        {screen === "confirm" && choice && (
          <>
            <h1>Here's your setup.</h1>
            {updated && <div className="fr-updated">✓ Nice — Desktop &amp; Documents is on. Your notes will follow you.</div>}
            <div className="fr-rows">
              <div className="fr-row">
                <div className="fr-k">Folder</div>
                <div>
                  <b>{choice.display}</b>
                  <span className="fr-path">{choice.path}</span>
                  <div className="fr-state">
                    <Mark tone={!choice.exists || (!choice.notes && !choice.other) ? "none" : choice.notes ? "ok" : "unknown"}>{stateLine(choice)}</Mark>
                  </div>
                </div>
              </div>
              <div className="fr-row">
                <div className="fr-k">Suggested?</div>
                <div>
                  {isSuggested ? (
                    <Mark tone="ok">Yes — the folder I suggest.</Mark>
                  ) : (
                    <Mark tone="unknown">Your pick — works just the same. I just won't look for it anywhere else.</Mark>
                  )}
                </div>
              </div>
              <div className="fr-row">
                <div className="fr-k">iCloud sync</div>
                <div>
                  <Mark tone={syncLine(choice, icloud).tone}>{syncLine(choice, icloud).text}</Mark>
                  {recommendDocuments(choice) && (
                    <div className="fr-rec">
                      <b>Recommended:</b> turn on <b>Desktop &amp; Documents</b> in iCloud settings, then come back here — this screen updates by itself. It puts
                      your whole Documents folder in iCloud Drive, which counts toward your iCloud storage.
                      <br />
                      <button className="fr-btn" onClick={() => backend.openSystemSettings("icloud").catch(() => {})}>
                        Open iCloud Settings
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="fr-row">
                <div className="fr-k">Git</div>
                <div>
                  <Mark tone={gitLine(choice).tone}>{gitLine(choice).text}</Mark>
                  <span className="fr-note">{gitLine(choice).note}</span>
                </div>
              </div>
              <div className="fr-row">
                <div className="fr-k">On the iPhone</div>
                <div>{iphoneLine(choice, icloud, isSuggested)}</div>
              </div>
            </div>
            <details className="fr-other" open={choice.sync.service !== "icloud"}>
              <summary>Other ways to sync</summary>
              <p>
                Parker doesn't sync anything itself — it reads and writes plain files, so any service that syncs a folder works: Dropbox, Google Drive,
                OneDrive, Box and others.
              </p>
              <ul>
                <li>
                  On the Mac, keep your notes folder inside that service's folder (<b>Back</b> › Create or select another folder…).
                </li>
                <li>
                  On the iPhone, install the service's app, then in Parker tap <b>Use another folder</b> and pick the same folder.
                </li>
              </ul>
            </details>
            <div className="fr-btns">
              <button className="fr-btn" disabled={busy} onClick={() => setScreen(from)}>
                Back
              </button>
              <span className="fr-grow" />
              <button className="fr-btn fr-pri" disabled={busy} onClick={finish}>
                Continue
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="fr-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
