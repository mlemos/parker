// What counts as a link to open, and where the bare ones are in a line of
// text. Pure: the editor's links (links.ts), the preview's (open.ts) and the
// note painter the iPhone runs (paint.ts) all read it.

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

/** Markdown nodes that carry a URL child. */
export const LINK_NODES = new Set(["Link", "Image", "Autolink"]);

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** The URLs in a line of text, trailing punctuation left out. */
export function scanUrls(text: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    let s = m[0];
    // A sentence's full stop, or the bracket the URL was written in, isn't
    // part of it; a bracket the URL itself opened is.
    for (;;) {
      const last = s[s.length - 1];
      if (/[.,;:!?'"]/.test(last)) s = s.slice(0, -1);
      else if (last === ")" && (s.match(/\(/g) ?? []).length < (s.match(/\)/g) ?? []).length)
        s = s.slice(0, -1);
      else break;
    }
    if (s.length) out.push({ from: m.index, to: m.index + s.length });
  }
  return out;
}
