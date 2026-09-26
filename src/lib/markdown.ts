import MarkdownIt from "markdown-it";
import { todoPlugin } from "./todo-markdown-it";
import { lineMapPlugin } from "./line-map";
import { imageAllowed, imageHost, imageKind } from "./images";
import type { ImageMode } from "./images";

// html:false keeps raw HTML in notes from executing (renders as text);
// markdown-it also validates link schemes, so javascript: links are dropped.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

// To-do lines render as to-do items here too, not as the literal text "/DONE".
md.use(todoPlugin);
// Every block carries the source line it starts on, for the preview to follow.
md.use(lineMapPlugin);

// A link's address on hover. Clicking opens the browser (MarkdownPreview), and
// there is no status bar here to say where a click would take you.
const linkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  if (!t.attrGet("title")) t.attrSet("title", t.attrGet("href") ?? "");
  return linkOpen(tokens, idx, options, env, self);
};

/** What a render needs to know about images: which ones Settings lets load,
 *  and how a local one becomes a URL the webview can fetch (the asset
 *  protocol, in the app). Without a resolver, local addresses are left as
 *  written — the harness and the tests. */
export interface RenderOptions {
  images?: ImageMode;
  resolveLocal?: (src: string) => string | null;
}

// Images follow Settings › Privacy & Security. One the setting doesn't allow
// is never put in an <img>, so nothing is fetched: it becomes a small box that
// says what was held back and links to the setting. The CSP backs this up.
const imageOpen =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  const opts = (env ?? {}) as RenderOptions;
  const mode = opts.images ?? "local";
  const src = String(t.attrGet("src") ?? "");
  const kind = imageKind(src);
  const alt = self.renderInlineAsText(t.children ?? [], options, env);
  if (!imageAllowed(kind, mode)) return blockedImage(kind, src, alt);
  if (kind === "local" && opts.resolveLocal) {
    const url = opts.resolveLocal(src);
    if (!url) return blockedImage("other", src, alt);
    t.attrSet("src", url);
  }
  return imageOpen(tokens, idx, options, env, self);
};

function blockedImage(kind: ReturnType<typeof imageKind>, src: string, alt: string): string {
  const esc = md.utils.escapeHtml;
  const what =
    kind === "remote" ? imageHost(src) || "remote image" : kind === "other" ? "unsupported address" : "local image";
  const title = alt ? `${alt} — ${src}` : src;
  const link =
    kind === "other" ? "" : ` <a class="img-blocked-link" data-action="privacy-settings">Privacy settings…</a>`;
  return (
    `<span class="img-blocked" title="${esc(title)}">` +
    `<span class="img-blocked-label">Image blocked · ${esc(what)}</span>${link}</span>`
  );
}

// GFM-style task lists: markdown-it leaves "[ ]" / "[x]" as literal text, so
// swap them for disabled checkboxes at the start of a list item. No space
// after the checkbox: its margin sets the gap (App.css li.task), so the text
// lands in the same column as every other item's.
// The <li> and <p> carry the line map's attribute, which rides along.
function taskLists(html: string): string {
  return html
    .replace(
      /<li([^>]*)>\s*(<p[^>]*>)?\[ \]\s?/g,
      '<li class="task"$1>$2<input type="checkbox" disabled>'
    )
    .replace(
      /<li([^>]*)>\s*(<p[^>]*>)?\[[xX]\]\s?/g,
      '<li class="task"$1>$2<input type="checkbox" checked disabled>'
    );
}

export function renderMarkdown(src: string, opts: RenderOptions = {}): string {
  return taskLists(md.render(src ?? "", { ...opts }));
}

export function isMarkdown(name: string | null | undefined): boolean {
  return !!name && /\.(md|markdown|mdown|mkd)$/i.test(name);
}
