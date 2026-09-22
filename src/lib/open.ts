// A link is followed in the system browser, never in Parker. The app is a
// webview, and a webview follows a link the way a browser tab does — by
// navigating, which swaps Parker for the page with no way back but a restart.
// Every link the editor or the preview lets you click comes through here.
import { openUrl } from "@tauri-apps/plugin-opener";

const EXTERNAL = /^(https?:|mailto:)/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The address to hand the browser for `href`, or null when it isn't one:
 *  a relative path, an anchor, or a scheme the browser has no business with. */
export function externalUrl(href: string): string | null {
  const s = href.trim();
  if (EXTERNAL.test(s)) return s;
  if (/^www\./i.test(s)) return "https://" + s;
  if (EMAIL.test(s)) return "mailto:" + s;
  return null;
}

/** Open `href` outside the app. Returns whether it was something to open. */
export function openExternal(href: string): boolean {
  const url = externalUrl(href);
  if (!url) return false;
  // Outside Tauri (the harness pages in a plain browser) a new tab is the
  // nearest thing to "outside".
  if ("__TAURI_INTERNALS__" in window) openUrl(url).catch(() => {});
  else window.open(url, "_blank", "noopener");
  return true;
}
