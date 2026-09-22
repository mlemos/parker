// Resolve a CodeMirror language extension from a note's filename.
//
// Markdown gets fenced-code highlighting via the full language-data set, and
// the inline-formatting keys (⌘B, ⌘I, ⌘K…) — marks that mean nothing in a
// .py or a .txt, so they come with the language rather than with the editor.
// Any other recognized extension is lazily loaded from language-data, so we
// get highlighting for dozens of languages without importing each package.
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { styleTags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { todoBlocks } from "./todo-markdown";
import { inlineCodeTag } from "./themes";
import { formatKeymap } from "./format";
import type { Extension } from "@uiw/react-codemirror";

/** Inline code gets a tag of its own (see themes.ts inlineCodeTag). */
// `/...` so the backticks (CodeMark, a mark with no style of its own) are inside the span.
const mdTags: MarkdownConfig = { props: [styleTags({ "InlineCode/...": inlineCodeTag })] };

export async function languageForName(name: string): Promise<Extension[]> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "md" || ext === "markdown" || ext === "mdx") {
    return [markdown({ codeLanguages: languages, extensions: [todoBlocks, mdTags] }), formatKeymap];
  }

  const desc = languages.find((l) => l.extensions.includes(ext));
  if (desc) {
    try {
      const support = await desc.load();
      return [support];
    } catch {
      return [];
    }
  }

  // Plain text (e.g. .txt or unknown): no highlighting, just a fast editor.
  return [];
}
