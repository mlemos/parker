// The first open on a Mac (Onda 5): where your notes will live.
//
// Parker used to make ~/Documents/Parker in silence, and macOS's Documents
// prompt arrived out of nowhere. Now it says hello first, looks in Documents ›
// Parker only when asked to (so the prompt comes explained, and "Don't Allow"
// is a path, not a dead end), shows what it found — notes, iCloud, git — and
// then one screen that explains the choice: where the folder is, whether it
// syncs, and what to do on the iPhone. Nothing is created until Continue.
//
// Screens follow the prototype approved on 24/09 ("Parker Mac First Run"),
// refined on 27/09 to match the iPhone's one for one: the site's lockup on the
// first screen, Back and the head on the others, the same blocks. Every word
// comes from shared/first-run-copy.json, which the iPhone reads too.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  afterLook,
  contentsLine,
  copy,
  gitLine,
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

/** A sentence from shared/first-run-copy.json (the Mac's version). */
const t = (key: string, vars?: Record<string, string | number>) => copy(key, vars);

/** The copy's markdown — **bold** and [links](url) — as elements. */
function md(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? <b key={m.index}>{m[1]}</b> : <a key={m.index} href={m[3]} target="_blank" rel="noreferrer">{m[2]}</a>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

const Mark = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`fr-mark fr-${tone}`}>{children}</span>
);

/** The brand, as the site wears it: the head and the lowercase wordmark. On
 *  the first screen only; the others carry the head alone, small. */
const Lockup = () => (
  <div className="fr-lockup" role="img" aria-label="Parker">
    <span className="fr-head" aria-hidden />
    <span className="fr-wordmark" aria-hidden>
      parker
    </span>
  </div>
);

function FolderCard({ f, tag }: { f: FolderInfo; tag: string }) {
  return (
    <div className="fr-card">
      <div className="fr-folder" aria-hidden />
      <div className="fr-card-text">
        <div className="fr-card-title">
          <span>{f.display}</span> <span className="fr-tag">{tag}</span>
        </div>
        <div className="fr-path">{f.path}</div>
      </div>
    </div>
  );
}

/** The found / fresh-start screens' x-ray of the suggested folder. */
function XRay({ f, icloud }: { f: FolderInfo; icloud: ICloudState }) {
  const sync = syncLine(f, icloud);
  const git = gitLine(f);
  return (
    <div className="fr-xray">
      <div className="fr-xr">
        <span className="fr-k">{t("xray.sync")}</span>
        <Mark tone={sync.tone}>{sync.text}</Mark>
      </div>
      <div className="fr-xr">
        <span className="fr-k">{t("xray.git")}</span>
        <Mark tone={git.tone}>{git.text}</Mark>
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
  const back = () => setScreen(screen === "confirm" ? from : "look");

  return (
    <div className="fr" role="main" aria-label="Welcome to Parker">
      <div className="fr-drag" data-tauri-drag-region />
      <div className="fr-body" data-screen={screen}>
        <div className="fr-top">
          {screen === "look" ? (
            <Lockup />
          ) : (
            <>
              <button className="fr-back" disabled={busy} onClick={back}>
                {t("back")}
              </button>
              <span className="fr-grow" />
              <span className="fr-head fr-head-small" role="img" aria-label="Parker" />
            </>
          )}
        </div>

        {screen === "look" && (
          <>
            <h1>{t("welcome.title")}</h1>
            <p className="fr-lead">{t("welcome.lead")}</p>
            <p className="fr-lead">{md(t("welcome.look"))}</p>
            <div className="fr-btns">
              <button className="fr-link" disabled={busy} onClick={() => pick("look")}>
                {t("choose")}
              </button>
              <span className="fr-grow" />
              <button className="fr-btn fr-pri" disabled={busy} onClick={look}>
                {busy ? t("welcome.looking") : t("welcome.primary")}
              </button>
            </div>
            <p className="fr-terms">{md(t("welcome.terms"))}</p>
          </>
        )}

        {screen === "denied" && (
          <>
            <h1>{t("denied.title")}</h1>
            <p className="fr-lead">{t("denied.lead")}</p>
            <p className="fr-hint">
              {t("denied.detail")}{" "}
              <button className="fr-link" disabled={busy} onClick={() => backend.openSystemSettings("privacy").catch(() => {})}>
                {t("denied.settings")}
              </button>
            </p>
            <div className="fr-btns">
              <button className="fr-link" disabled={busy} onClick={look}>
                {t("retry")}
              </button>
              <span className="fr-grow" />
              <button className="fr-btn fr-pri" disabled={busy} onClick={() => pick("denied")}>
                {t("choose")}
              </button>
            </div>
          </>
        )}

        {(screen === "found" || screen === "create") && suggested && (
          <>
            <h1>{t(screen === "found" ? "found.title" : "create.title")}</h1>
            <p className="fr-lead">
              {md(screen === "found" ? t("found.lead", { contents: contentsLine(suggested), folder: suggested.display }) : t("create.lead", { folder: suggested.display }))}
            </p>
            <FolderCard f={suggested} tag={t("card.suggested")} />
            <XRay f={suggested} icloud={icloud} />
            {screen === "create" && icloud.documents && (
              // A new Mac, iCloud still bringing the files over: creating now
              // would make iCloud keep both, as "Parker 2" (stress test, 24/09).
              <p className="fr-hint">
                {t("create.arriving")}{" "}
                <button className="fr-link" disabled={busy} onClick={look}>
                  {t("retry")}
                </button>
              </p>
            )}
            <div className="fr-btns">
              <button className="fr-link" disabled={busy} onClick={() => pick(screen)}>
                {t("choose")}
              </button>
              <span className="fr-grow" />
              <button className="fr-btn fr-pri" disabled={busy} onClick={() => useSuggested(screen)}>
                {t(screen === "found" ? "found.primary" : "create.primary")}
              </button>
            </div>
          </>
        )}

        {screen === "confirm" && choice && (
          <>
            <h1>{t("setup.title")}</h1>
            {updated && <div className="fr-updated">{t("setup.updated")}</div>}
            <div className="fr-rows">
              <div className="fr-row">
                <div className="fr-k">{t("setup.folder")}</div>
                <div>
                  <div className="fr-card-title">
                    <span>{choice.display}</span> <span className={`fr-tag${isSuggested ? "" : " fr-tag-quiet"}`}>{t(isSuggested ? "card.suggested" : "card.yourChoice")}</span>
                  </div>
                  <span className="fr-path">{choice.path}</span>
                  <div className="fr-state">
                    <Mark tone={!choice.exists || (!choice.notes && !choice.other) ? "none" : choice.notes ? "ok" : "unknown"}>{stateLine(choice)}</Mark>
                  </div>
                </div>
              </div>
              <div className="fr-row">
                <div className="fr-k">{t("setup.sync")}</div>
                <div>
                  <Mark tone={syncLine(choice, icloud).tone}>{syncLine(choice, icloud).text}</Mark>
                  {recommendDocuments(choice) && (
                    <div className="fr-rec">
                      <p>{md(t("setup.recommend"))}</p>
                      <button className="fr-btn" onClick={() => backend.openSystemSettings("icloud").catch(() => {})}>
                        {t("setup.recommendButton")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="fr-row">
                <div className="fr-k">{t("setup.git")}</div>
                <div>
                  <Mark tone={gitLine(choice).tone}>{gitLine(choice).text}</Mark>
                  <span className="fr-note">{gitLine(choice).note}</span>
                </div>
              </div>
              <div className="fr-row">
                <div className="fr-k">{t("setup.otherDevice")}</div>
                <div>{iphoneLine(choice, icloud, isSuggested)}</div>
              </div>
            </div>
            <details className="fr-other">
              <summary>{t("setup.otherWays")}</summary>
              <p>{t("setup.otherWaysBody")}</p>
              <p>{t("setup.otherWaysHow")}</p>
            </details>
            <div className="fr-btns">
              <span className="fr-grow" />
              <button className="fr-btn fr-pri" disabled={busy} onClick={finish}>
                {t("continue")}
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
