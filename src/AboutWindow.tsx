import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { themeById, DEFAULT_THEME_ID } from "./lib/themes";
import "./App.css";

const REPO = "https://github.com/mlemos/parker";

// Follow the editor's theme (passed in the URL when the window opens).
const themeId =
  new URLSearchParams(window.location.search).get("theme") || DEFAULT_THEME_ID;
const theme = themeById(themeId);

// Standalone About window (its own Tauri window).
export default function AboutWindow() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const u = theme.ui;
    const root = document.documentElement;
    const vars: Record<string, string> = {
      "--text": u.text,
      "--secondary": u.secondary,
      "--muted": u.muted,
      "--border": u.border,
      "--accent": u.accent,
      "--danger": u.danger,
      "--editor-bg": u.editorBg,
      "--on-accent": u.onAccent,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.mode = theme.mode;
    root.dataset.theme = theme.id;
    document.body.style.background = u.editorBg;
  }, []);

  const open = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    openUrl(url).catch(() => {});
  };

  // Paper (light) lockup on dark themes, ink (dark) lockup on light themes.
  const lockup =
    theme.mode === "dark"
      ? "/logo-horizontal-paper.png"
      : "/logo-horizontal-ink.png";

  return (
    <div className="aboutwin" data-tauri-drag-region>
      <img className="aboutwin-lockup" src={lockup} alt="Parker" />
      <div className="aboutwin-version">
        {version ? `Version ${version}` : ""}
      </div>
      <p className="aboutwin-tagline">
        A fast, minimal, keyboard-first editor for notes, code and markdown.
      </p>

      <div className="aboutwin-note">
        <strong>Beta software.</strong> Provided as-is, with no warranty of any
        kind. It may change, break, or lose data. Use at your own risk — keep
        backups (Parker's Git sync helps).
      </div>

      <div className="aboutwin-links">
        <a href={REPO} onClick={open(REPO)}>
          GitHub
        </a>
        <span className="aboutwin-sep">·</span>
        <a href={`${REPO}/releases`} onClick={open(`${REPO}/releases`)}>
          Releases
        </a>
      </div>

      <div className="aboutwin-foot">© 2026 Manoel Lemos</div>
    </div>
  );
}
