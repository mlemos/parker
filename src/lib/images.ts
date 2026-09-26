// Which images the preview may load, and where a local one lives.
//
// Settings › Privacy & Security › Images in preview: "none", "local" (the
// default) or "all". A LOCAL image is a file next to the note
// (`![](img/photo.png)`): it never leaves the Mac. A REMOTE one
// (`![](https://…)`) is fetched from its server when the note opens, and that
// server sees when and from which IP — the tracking pixel of marketing email.
//
// The rules are pure and tested here; MarkdownPreview turns a local path into
// an asset-protocol URL, which Rust only serves from the notes folder and the
// folders of external files the user opened.

export type ImageMode = "none" | "local" | "all";

export const IMAGE_MODES: { id: ImageMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "local", label: "Local only" },
  { id: "all", label: "Local and remote" },
];

export const DEFAULT_IMAGE_MODE: ImageMode = "local";

/** A saved or received mode, or the default for anything unknown. */
export function imageModeOf(v: unknown): ImageMode {
  return v === "none" || v === "local" || v === "all" ? v : DEFAULT_IMAGE_MODE;
}

export type ImageKind = "remote" | "local" | "inline" | "other";

/** What an image's address points at. `data:` images are already in the note
 *  (markdown-it only lets image types through), so they count as inline. */
export function imageKind(src: string): ImageKind {
  const s = src.trim();
  if (/^(https?:)?\/\//i.test(s)) return "remote";
  if (/^data:image\//i.test(s)) return "inline";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "other"; // file:, asset:, ftp:…
  return s ? "local" : "other";
}

/** Whether `mode` lets an image of this kind load. Nothing else ever does. */
export function imageAllowed(kind: ImageKind, mode: ImageMode): boolean {
  if (kind === "remote") return mode === "all";
  if (kind === "local" || kind === "inline") return mode !== "none";
  return false;
}

/** The host a remote image would be fetched from, for the blocked box. */
export function imageHost(src: string): string {
  const m = /^(?:https?:)?\/\/([^/?#]+)/i.exec(src.trim());
  return m ? m[1].replace(/^[^@]*@/, "") : "";
}

/**
 * The absolute file a local image names. `note` is the note's name as the app
 * holds it: relative to `notesDir` for a note ("trips/lisbon.md"), or an
 * absolute path for an external file. `src` is the address as written, URL
 * encoded the way markdown-it leaves it. `.` and `..` are resolved; a path
 * that climbs above the filesystem root is refused (null).
 */
export function localImagePath(notesDir: string, note: string, src: string): string | null {
  let raw: string;
  try {
    raw = decodeURI(src.trim().split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (!raw) return null;
  const notePath = note.startsWith("/") ? note : `${notesDir.replace(/\/+$/, "")}/${note}`;
  const base = notePath.slice(0, notePath.lastIndexOf("/"));
  const joined = raw.startsWith("/") ? raw : `${base}/${raw}`;
  const out: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return "/" + out.join("/");
}
