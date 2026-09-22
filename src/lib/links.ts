// Links in the editor: which spans are one, and following them with ⌘-click.
//
// A plain click must keep placing the caret — you edit links more often than
// you follow them — so following takes the ⌘, as in VS Code and Obsidian,
// and the pointer says so while ⌘ is down. The address comes from the syntax
// tree when there is one (`[text](url)`, `<url>`, an autolinked URL or
// address) and from a scan of the line otherwise, so a URL in a .txt note
// opens too. Opening is lib/open's business: always outside the app.
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, RangeSetBuilder, ViewPlugin } from "@uiw/react-codemirror";
import type { DecorationSet, EditorState, ViewUpdate } from "@uiw/react-codemirror";
import { externalUrl, openExternal } from "./open";

export interface LinkSpan {
  from: number;
  to: number;
  /** Ready for the browser. */
  url: string;
}

/** @lezer/common is not a dependency of ours, only of CodeMirror's. */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/** Markdown nodes that carry a URL child. */
const LINK_NODES = new Set(["Link", "Image", "Autolink"]);

function fromTree(state: EditorState, pos: number): LinkSpan | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    // The whole link when there is one, so a click on its text and a click
    // on its address are the same link; a bare URL node otherwise.
    let bare: SyntaxNode | null = null;
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (LINK_NODES.has(n.name)) {
        const u = n.getChild("URL");
        const url = u && externalUrl(state.sliceDoc(u.from, u.to));
        return url ? { from: n.from, to: n.to, url } : null;
      }
      if (n.name === "URL") bare = n;
    }
    if (bare) {
      const url = externalUrl(state.sliceDoc(bare.from, bare.to));
      return url ? { from: bare.from, to: bare.to, url } : null;
    }
  }
  return null;
}

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

function fromText(state: EditorState, pos: number): LinkSpan | null {
  const line = state.doc.lineAt(pos);
  for (const r of scanUrls(line.text)) {
    const from = line.from + r.from;
    const to = line.from + r.to;
    if (from <= pos && pos < to) {
      const url = externalUrl(state.sliceDoc(from, to));
      return url ? { from, to, url } : null;
    }
  }
  return null;
}

/** The link at `pos`, if the character there belongs to one. */
export function linkAt(state: EditorState, pos: number): LinkSpan | null {
  return fromTree(state, pos) ?? fromText(state, pos);
}

/**
 * A link span's mark. Every link gets `cm-ext-link` (App.css: a tint on hover,
 * a pointer while ⌘ is down) and a tooltip saying what ⌘-click will open. A
 * URL the parser didn't see — bare in a paragraph, or in a file with no
 * markdown at all — also gets `cm-ext-url`, which paints it in the theme's
 * url colour; the ones the parser did see are already painted by the theme.
 */
function mark(url: string, bare: boolean): Decoration {
  return Decoration.mark({
    class: bare ? "cm-ext-link cm-ext-url" : "cm-ext-link",
    attributes: { title: `⌘-click to open ${url}` },
  });
}

/** Every link span in view. */
function spans(view: EditorView): DecorationSet {
  const state = view.state;
  const found: { from: number; to: number; url: string; bare: boolean }[] = [];
  const push = (from: number, to: number, bare: boolean) => {
    const url = externalUrl(state.sliceDoc(from, to));
    if (url) found.push({ from, to, url, bare });
  };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(n) {
        if (LINK_NODES.has(n.name)) {
          const u = n.node.getChild("URL");
          if (!u) return true;
          const url = externalUrl(state.sliceDoc(u.from, u.to));
          if (url) found.push({ from: n.from, to: n.to, url, bare: false });
          return false;
        }
        if (n.name === "URL") push(n.from, n.to, false);
        return true;
      },
    });
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      for (const r of scanUrls(line.text)) {
        const a = line.from + r.from;
        const z = line.from + r.to;
        if (!found.some((f) => f.from <= a && z <= f.to)) push(a, z, true);
      }
      pos = line.to + 1;
    }
  }
  found.sort((a, b) => a.from - b.from);
  const b = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const r of found) {
    if (r.from < last || r.from >= r.to) continue;
    b.add(r.from, r.to, mark(r.url, r.bare));
    last = r.to;
  }
  return b.finish();
}

const linkSpans = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = spans(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = spans(u.view);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        if (!e.metaKey || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const link = linkAt(view.state, pos);
        if (!link) return false;
        e.preventDefault();
        openExternal(link.url);
        return true;
      },
    },
  }
);

/** `.cm-meta` on the editor while ⌘ is down, so links can show a pointer. */
const metaDown = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      window.addEventListener("keydown", this.key);
      window.addEventListener("keyup", this.key);
      window.addEventListener("blur", this.off);
    }
    key = (e: KeyboardEvent) => this.view.dom.classList.toggle("cm-meta", e.metaKey);
    off = () => this.view.dom.classList.remove("cm-meta");
    destroy() {
      window.removeEventListener("keydown", this.key);
      window.removeEventListener("keyup", this.key);
      window.removeEventListener("blur", this.off);
    }
  }
);

/** Styling lives in App.css (.cm-ext-link / .cm-ext-url), with the theme's vars. */
export const followLinks = [linkSpans, metaDown];
