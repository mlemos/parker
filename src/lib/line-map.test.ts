import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.ts";
import { blockAt, blockRange, blocksBetween, blocksWithLines } from "./line-map.ts";

const lines = (html: string) =>
  [...html.matchAll(/<(\w+)[^>]*\sdata-line="(\d+)"/g)].map((m) => `${m[1]}:${m[2]}`);

describe("the line map in the rendered HTML", () => {
  it("stamps each block with the line it starts on", () => {
    const html = renderMarkdown("# Title\n\nA paragraph.\n\n- one\n- two\n");
    expect(lines(html)).toEqual(["h1:1", "p:3", "ul:5", "li:5", "li:6"]);
  });

  it("covers fences, quotes and rules — the one-token blocks too", () => {
    const html = renderMarkdown("> quoted\n\n```\ncode\n```\n\n---\n");
    // markdown-it puts a fence's attributes on the <code> inside the <pre>.
    expect(lines(html)).toEqual(["blockquote:1", "p:1", "code:3", "hr:7"]);
  });

  it("gives a to-do entry its line, and its nested lines theirs", () => {
    const html = renderMarkdown("intro\n\n/TODO buy milk\n  - oat\n  - whole\n");
    expect(lines(html)).toEqual(["p:1", "div:3", "ul:4", "li:4", "li:5"]);
  });

  it("does not touch inline content or closing tags", () => {
    const html = renderMarkdown("a *b* c");
    expect(html).toBe('<p data-line="1">a <em>b</em> c</p>\n');
  });

  it("changes nothing else about the output", () => {
    const html = renderMarkdown("- [ ] task\n- [x] done\n");
    expect(html).toContain('<li class="task" data-line="1"><input type="checkbox" disabled>');
    expect(html).toContain('<li class="task" data-line="2"><input type="checkbox" checked disabled>');
  });
});

describe("reading the map", () => {
  // h1@1, p@3, ul@5, li@5, li@6, p@8
  const starts = [1, 3, 5, 5, 6, 8];

  it("finds the innermost block at a line", () => {
    expect(blockAt(starts, 1)).toBe(0);
    expect(blockAt(starts, 2)).toBe(0); // the blank after the title still reads as the title
    expect(blockAt(starts, 5)).toBe(3); // the li, not the ul
    expect(blockAt(starts, 7)).toBe(4);
    expect(blockAt(starts, 99)).toBe(5);
  });

  it("has nothing above the first block", () => {
    expect(blockAt([3, 4], 1)).toBe(-1);
  });

  it("gives a container an empty range when its child starts with it", () => {
    expect(blockRange(starts, 2)).toEqual([5, 5]); // ul
    expect(blockRange(starts, 3)).toEqual([5, 6]); // li
    expect(blockRange(starts, 5)).toEqual([8, Infinity]);
  });

  it("marks the blocks that hold changed lines, innermost only", () => {
    expect(blocksWithLines(starts, [6])).toEqual([4]);
    expect(blocksWithLines(starts, [1, 9])).toEqual([0, 5]);
    expect(blocksWithLines(starts, [])).toEqual([]);
  });

  it("marks the blocks a selection runs through", () => {
    expect(blocksBetween(starts, 3, 6)).toEqual([1, 3, 4]);
    expect(blocksBetween(starts, 6, 3)).toEqual([1, 3, 4]); // either direction
    expect(blocksBetween(starts, 5, 5)).toEqual([3]);
  });
});
