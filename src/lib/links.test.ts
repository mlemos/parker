import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { languageForName } from "./lang.ts";
import { linkAt, scanUrls } from "./links.ts";

async function markdown(doc: string): Promise<EditorState> {
  const state = EditorState.create({ doc, extensions: await languageForName("n.md") });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

describe("the link at a position, in markdown", () => {
  it("resolves [text](url) from anywhere in it, text included", async () => {
    const s = await markdown("see [Parker](https://getparker.dev) now");
    const at = linkAt(s, 6);
    expect(at).toEqual({ from: 4, to: 35, url: "https://getparker.dev" });
    expect(linkAt(s, 20)).toEqual(at);
  });
  it("resolves <url> and a bare url", async () => {
    expect(linkAt(await markdown("at <https://x.io/a>"), 5)?.url).toBe("https://x.io/a");
    expect(linkAt(await markdown("at https://x.io/a."), 5)?.url).toBe("https://x.io/a");
  });
  it("completes what markdown autolinks without a scheme", async () => {
    expect(linkAt(await markdown("at www.x.io/a"), 5)?.url).toBe("https://www.x.io/a");
    expect(linkAt(await markdown("mail <me@example.com>"), 7)?.url).toBe("mailto:me@example.com");
  });
  it("resolves an image's address", async () => {
    expect(linkAt(await markdown("![a](https://i.io/p.png)"), 2)?.url).toBe("https://i.io/p.png");
  });
  it("is nothing on plain text, a relative link, or a reference link", async () => {
    expect(linkAt(await markdown("see [Parker](https://getparker.dev) now"), 1)).toBeNull();
    expect(linkAt(await markdown("[a](other.md)"), 1)).toBeNull();
    expect(linkAt(await markdown("[a][ref]"), 1)).toBeNull();
  });
});

describe("the link at a position, without a language", () => {
  it("finds a url by scanning the line", () => {
    const s = EditorState.create({ doc: "todo: https://x.io/a, then rest" });
    expect(linkAt(s, 10)).toEqual({ from: 6, to: 20, url: "https://x.io/a" });
    expect(linkAt(s, 20)).toBeNull();
    expect(linkAt(s, 2)).toBeNull();
  });
});

describe("scanning a line for urls", () => {
  it("leaves the sentence's punctuation and a wrapping bracket out", () => {
    const line = "(see https://x.io/a). Or https://y.io/b?q=1!";
    expect(scanUrls(line).map((r) => line.slice(r.from, r.to))).toEqual([
      "https://x.io/a",
      "https://y.io/b?q=1",
    ]);
  });
  it("keeps a bracket the url itself opened", () => {
    const line = "https://en.wikipedia.org/wiki/Foo_(bar) x";
    expect(scanUrls(line).map((r) => line.slice(r.from, r.to))).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
  });
});
