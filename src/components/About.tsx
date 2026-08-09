import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const REPO = "https://github.com/mlemos/parker";

export function About({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const open = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    openUrl(url).catch(() => {});
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="about" onMouseDown={(e) => e.stopPropagation()}>
        <button className="about-x" onClick={onClose} title="Close (Esc)">
          ×
        </button>

        <div className="about-mark">Parker</div>
        <div className="about-version">
          {version ? `Version ${version}` : ""}
        </div>
        <p className="about-tagline">
          A fast, minimal, keyboard-first editor for notes, code and markdown.
        </p>

        <div className="about-note">
          <strong>Beta software.</strong> Provided as-is, with no warranty of
          any kind. It may change, break, or lose data. Use at your own risk —
          keep backups (Parker's Git sync helps).
        </div>

        <div className="about-links">
          <a href={REPO} onClick={open(REPO)}>
            GitHub
          </a>
          <span className="about-sep">·</span>
          <a href={`${REPO}/releases`} onClick={open(`${REPO}/releases`)}>
            Releases
          </a>
        </div>

        <div className="about-foot">© 2026 Manoel Lemos</div>
      </div>
    </div>
  );
}
