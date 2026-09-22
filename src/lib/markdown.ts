import MarkdownIt from "markdown-it";
import { todoPlugin } from "./todo-markdown-it";
import { lineMapPlugin } from "./line-map";

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

export function renderMarkdown(src: string): string {
  return taskLists(md.render(src ?? ""));
}

export function isMarkdown(name: string | null | undefined): boolean {
  return !!name && /\.(md|markdown|mdown|mkd)$/i.test(name);
}
