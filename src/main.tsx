import React from "react";
import ReactDOM from "react-dom/client";
// Geist (Vercel's typeface), bundled locally so the app stays offline-safe.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
