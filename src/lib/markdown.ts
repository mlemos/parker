import MarkdownIt from "markdown-it";
import { todoPlugin } from "./todo-markdown-it";

// html:false keeps raw HTML in notes from executing (renders as text);
// markdown-it also validates link schemes, so javascript: links are dropped.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

// To-do lines render as to-do items here too, not as the literal text "/DONE".
md.use(todoPlugin);

// GFM-style task lists: markdown-it leaves "[ ]" / "[x]" as literal text, so
// swap them for disabled checkboxes at the start of a list item.
function taskLists(html: string): string {
  return html
    .replace(
      /<li>\s*(<p>)?\[ \]\s?/g,
      '<li class="task">$1<input type="checkbox" disabled> '
    )
    .replace(
      /<li>\s*(<p>)?\[[xX]\]\s?/g,
      '<li class="task">$1<input type="checkbox" checked disabled> '
    );
}

export function renderMarkdown(src: string): string {
  return taskLists(md.render(src ?? ""));
}

export function isMarkdown(name: string | null | undefined): boolean {
  return !!name && /\.(md|markdown|mdown|mkd)$/i.test(name);
}
