// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPosition, postCursor, postViewport } from "../lib/preview-sync.ts";
import { MarkdownPreview } from "./MarkdownPreview.tsx";
import { openExternal } from "../lib/open.ts";

afterEach(cleanup);
// The bus remembers the last position per note across renders — which is the
// feature — so each test starts from nothing.
beforeEach(() => forgetPosition("n.md"));

const DOC = "# Title\n\nIntro.\n\n## Two\n\nPara two.\n\n- a\n- b\n";

describe("MarkdownPreview following the editor", () => {
  it("lights the block the cursor is in", () => {
    const { container } = render(<MarkdownPreview content={DOC} name="n.md" sync />);
    act(() => postCursor({ name: "n.md", line: 7, from: 7, to: 7 }));
    const lit = container.querySelectorAll(".md-cursor");
    expect(lit).toHaveLength(1);
    expect(lit[0].textContent).toBe("Para two.");
  });

  it("covers the blocks a selection runs through", () => {
    const { container } = render(<MarkdownPreview content={DOC} name="n.md" sync />);
    act(() => postCursor({ name: "n.md", line: 9, from: 3, to: 9 }));
    const sel = [...container.querySelectorAll(".md-selected")].map((e) => e.tagName);
    expect(sel).toEqual(["P", "H2", "P", "LI"]);
  });

  it("paints the changed lines amber", () => {
    const { container } = render(
      <MarkdownPreview content={DOC} name="n.md" changed={[1, 10]} sync />
    );
    const amber = [...container.querySelectorAll(".md-changed")].map((e) => e.textContent);
    expect(amber).toEqual(["Title", "b"]);
  });

  it("ignores another note's cursor, and everything when sync is off", () => {
    const { container, rerender } = render(<MarkdownPreview content={DOC} name="n.md" sync />);
    act(() => postCursor({ name: "other.md", line: 7, from: 7, to: 7 }));
    expect(container.querySelector(".md-cursor")).toBeNull();
    act(() => postCursor({ name: "n.md", line: 7, from: 7, to: 7 }));
    expect(container.querySelector(".md-cursor")).not.toBeNull();
    rerender(<MarkdownPreview content={DOC} name="n.md" sync={false} />);
    expect(container.querySelector(".md-cursor")).toBeNull();
    act(() => postCursor({ name: "n.md", line: 1, from: 1, to: 1 }));
    expect(container.querySelector(".md-cursor")).toBeNull();
  });

  it("starts where the editor already is when opened later", () => {
    postViewport({ name: "late.md", top: 5 });
    postCursor({ name: "late.md", line: 5, from: 5, to: 5 });
    const { container } = render(<MarkdownPreview content={DOC} name="late.md" sync />);
    expect(container.querySelector(".md-cursor")?.textContent).toBe("Two");
  });

  it("keeps the marks across a re-render of new content", () => {
    const { container, rerender } = render(<MarkdownPreview content={DOC} name="n.md" sync />);
    act(() => postCursor({ name: "n.md", line: 7, from: 7, to: 7 }));
    rerender(<MarkdownPreview content={DOC + "\nMore.\n"} name="n.md" sync />);
    expect(container.querySelector(".md-cursor")?.textContent).toBe("Para two.");
  });
});

vi.mock("../lib/open.ts", () => ({ openExternal: vi.fn(() => true) }));

describe("links in the preview", () => {
  it("open outside the app instead of navigating the webview", () => {
    const spy = vi.mocked(openExternal);
    const { container } = render(
      <MarkdownPreview content="see [Parker](https://getparker.dev)" name="n.md" sync={false} />
    );
    const a = container.querySelector("a")!;
    expect(a.getAttribute("title")).toBe("https://getparker.dev");
    const followed = fireEvent.click(a);
    expect(followed).toBe(false); // default prevented: the webview stays put
    expect(spy).toHaveBeenCalledWith("https://getparker.dev");
  });

  it("leave a plain click on text alone", () => {
    const { container } = render(
      <MarkdownPreview content="just text" name="n.md" sync={false} />
    );
    expect(fireEvent.click(container.querySelector("p")!)).toBe(true);
  });
});
