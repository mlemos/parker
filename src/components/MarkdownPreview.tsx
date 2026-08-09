import { useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";

// Read-only rendered view of a markdown buffer. Content is shared state, so it
// re-renders live as the note is edited in another pane.
export function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div className="md-preview">
      <div
        className="md-body"
        // Safe: markdown-it runs with html:false and validates link schemes.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
