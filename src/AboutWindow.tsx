import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { themeById, DEFAULT_THEME_ID } from "./lib/themes";
import "./App.css";

const REPO = "https://github.com/mlemos/parker";

// Standalone About window (its own Tauri window). Always branded dark.
export default function AboutWindow() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const u = themeById(DEFAULT_THEME_ID).ui;
    const root = document.documentElement;
    const vars: Record<string, string> = {
      "--text": u.text,
      "--secondary": u.secondary,
      "--muted": u.muted,
      "--border": u.border,
      "--accent": u.accent,
      "--danger": u.danger,
      "--editor-bg": u.editorBg,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.mode = "dark";
    document.body.style.background = u.editorBg;
  }, []);

  const open = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    openUrl(url).catch(() => {});
  };

  return (
    <div className="aboutwin">
      <img
        className="aboutwin-logo"
        src="/logo.png"
        alt="Parker"
        width={88}
        height={88}
      />
      <div className="aboutwin-mark">Parker</div>
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
