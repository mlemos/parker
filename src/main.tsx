import React from "react";
import ReactDOM from "react-dom/client";
// Geist (Vercel's typeface), bundled locally so the app stays offline-safe.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import App from "./App";
import AboutWindow from "./AboutWindow";
import HelpWindow from "./HelpWindow";
import SettingsRoot from "./SettingsRoot";

// Secondary Tauri windows load index.html?view=… — render the matching
// standalone view there instead of the full editor.
const params = new URLSearchParams(window.location.search);
const view = params.get("view");

// A note window is the editor with its tab strip locked to one note: same
// App, told which note and — so the first frame is already the right colour —
// which theme and whether it is pinned above the others.
const noteWindow =
  view === "note" && params.get("name")
    ? {
        name: params.get("name")!,
        theme: params.get("theme") || null,
        onTop: params.get("top") === "1",
        preview: params.get("preview") === "1",
      }
    : undefined;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {view === "about" ? (
      <AboutWindow />
    ) : view === "help" ? (
      <HelpWindow />
    ) : view === "settings" ? (
      <SettingsRoot />
    ) : (
      <App noteWindow={noteWindow} initialTheme={params.get("theme")} />
    )}
  </React.StrictMode>,
);
