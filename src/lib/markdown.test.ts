import { describe, expect, it } from "vitest";
import { isMarkdown, renderMarkdown } from "./markdown.ts";

// The preview injects this HTML into the app's own window, so a note is an
// untrusted input with the app's privileges. Notes arrive by git pull and by
// sync from other machines, not only from the person typing.
describe("renderMarkdown / untrusted input", () => {
  it("renders raw HTML as text instead of executing it", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("neutralises inline event handlers", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("refuses to build a javascript: link", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("href");
  });

  it("still builds ordinary links", () => {
    expect(renderMarkdown("[ok](https://example.org)")).toContain(
      '<a href="https://example.org">ok</a>'
    );
  });

  it("survives an empty or missing document", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null as unknown as string)).toBe("");
  });
});

describe("renderMarkdown / task lists", () => {
  it("turns GFM checkboxes into disabled inputs", () => {
    const html = renderMarkdown("- [ ] milk\n- [x] bread");
    expect(html).toContain('<li class="task"><input type="checkbox" disabled> milk</li>');
    expect(html).toContain(
      '<li class="task"><input type="checkbox" checked disabled> bread</li>'
    );
  });

  it("accepts an upper-case X and ordered lists", () => {
    expect(renderMarkdown("1. [X] one")).toContain('checked disabled> one');
  });

  it("handles loose list items, where the text is wrapped in a paragraph", () => {
    const html = renderMarkdown("- [ ] a\n\n- [ ] b");
    expect(html).toContain('<li class="task"><p><input type="checkbox" disabled> a</p>');
  });

  it("leaves brackets that aren't a checkbox alone", () => {
    const html = renderMarkdown("- [pending] ship it");
    expect(html).not.toContain("checkbox");
  });
});

describe("isMarkdown", () => {
  it("accepts every extension the editor previews", () => {
    for (const name of ["a.md", "a.markdown", "a.mdown", "a.mkd", "A.MD", "notes.2026.md"])
      expect(isMarkdown(name)).toBe(true);
  });

  it("rejects everything else, including a bare name and no name at all", () => {
    for (const name of ["a.txt", "a.rs", "readme", "md", "a.md.txt", "", null, undefined])
      expect(isMarkdown(name)).toBe(false);
  });
});
