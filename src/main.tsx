import React from "react";
import ReactDOM from "react-dom/client";
// Geist (Vercel's typeface), bundled locally so the app stays offline-safe.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import App from "./App";
import AboutWindow from "./AboutWindow";
import HelpWindow from "./HelpWindow";

// Secondary Tauri windows load index.html?view=… — render the matching
// standalone view there instead of the full editor.
const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {view === "about" ? (
      <AboutWindow />
    ) : view === "help" ? (
      <HelpWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
