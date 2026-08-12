import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { themeById, DEFAULT_THEME_ID } from "./lib/themes";
import "./App.css";

const REPO = "https://github.com/mlemos/parker";

const initialTheme =
  new URLSearchParams(window.location.search).get("theme") || DEFAULT_THEME_ID;

// Standalone About window (its own Tauri window).
export default function AboutWindow() {
  const [version, setVersion] = useState("");
  const [themeId, setThemeId] = useState(initialTheme);
  const theme = themeById(themeId);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  // Follow the main window's live theme changes.
  useEffect(() => {
    const p = listen<string>("parker://theme", (e) => setThemeId(e.payload));
    return () => {
      p.then((un) => un());
    };
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
  }, [theme]);

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
