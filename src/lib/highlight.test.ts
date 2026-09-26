import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { Highlight } from "./highlight";

const names = (src: string): string[] => {
  const out: string[] = [];
  markdown({ extensions: [Highlight] }).language.parser.parse(src).iterate({
    enter: (n) => {
      out.push(n.name);
    },
  });
  return out;
};

describe("==highlight== in the editor's parser", () => {
  it("parses ==text== as a Highlight node with its marks", () => {
    const n = names("a ==big **deal**== here");
    expect(n).toContain("Highlight");
    expect(n.filter((x) => x === "HighlightMark")).toHaveLength(2);
    expect(n).toContain("StrongEmphasis");
  });
  it("does not open on a lone = or on ===", () => {
    expect(names("a = b === c")).not.toContain("Highlight");
    expect(names("a == b")).not.toContain("Highlight");
  });
});
