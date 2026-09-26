// The Settings window as the app runs it: the real backend, the window shown
// once its themed first frame has painted, and ⌘W to close it.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { SECTION_KEY, SettingsWindow, applyWindowTheme } from "./SettingsWindow";
import { tauriBackend } from "./settingsBackend";
import { DEFAULT_THEME_ID } from "./lib/themes";

const params = new URLSearchParams(window.location.search);
const initialTheme = params.get("theme") || DEFAULT_THEME_ID;

/** Open on `section`: the window starts on the section it last showed, so
 *  asking for one is making it the last shown. */
function goTo(section: string | null) {
  if (!section) return;
  try {
    localStorage.setItem(SECTION_KEY, section);
  } catch {
    /* private storage: it opens where it would have */
  }
}
goTo(params.get("section"));
// Paint before React's first render so the first frame is already themed.
applyWindowTheme(initialTheme);

export default function SettingsRoot() {
  // Closing hides this window (Rust keeps it), so each time it comes back it
  // starts over: a fresh read of every setting and of the skill's state.
  const [shown, setShown] = useState(0);
  // The theme it comes back in is the one in force now, not the one in the
  // URL it was created with: a theme picked while it was open (or hidden)
  // would otherwise be undone by the fresh start.
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    const w = getCurrentWebviewWindow();
    const shownP = w.listen("parker://settings-shown", () => setShown((n) => n + 1));
    const themeP = listen<string>("parker://theme", (e) => setTheme(e.payload));
    // Asked for a section while open (or hidden): go there, starting over.
    const sectionP = w.listen<string>("parker://settings-section", (e) => {
      goTo(e.payload);
      setShown((n) => n + 1);
    });
    return () => {
      shownP.then((un) => un());
      themeP.then((un) => un());
      sectionP.then((un) => un());
    };
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      getCurrentWindow().show().catch(() => {});
      getCurrentWindow().setFocus().catch(() => {});
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        getCurrentWindow().close().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return <SettingsWindow key={shown} backend={tauriBackend} initialTheme={theme} />;
}
