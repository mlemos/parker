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

  // The four the CSP plan asked for (Onda 4): each is a known way past a
  // markdown renderer. The CSP is the net under them; these keep the first
  // line honest.
  it("keeps raw HTML inert inside a link's text", () => {
    const html = renderMarkdown("[<img src=x onerror=alert(1)>](https://example.org)");
    expect(html).not.toMatch(/<img/);
    expect(html).toContain("&lt;img");
  });

  it("refuses a data: page as a link", () => {
    expect(renderMarkdown("[x](data:text/html,<script>alert(1)</script>)")).not.toContain("href");
    expect(renderMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)")).not.toContain("href");
  });

  it("doesn't let linkify turn a bare javascript: into a link", () => {
    const html = renderMarkdown("see javascript:alert(1) now");
    expect(html).not.toContain("<a");
  });

  it("refuses javascript: in any case and behind entities", () => {
    for (const src of [
      "[x](JaVaScRiPt:alert(1))",
      "[x](&#106;avascript:alert(1))",
      "[x](java&#115;cript:alert(1))",
      "[x](&#x6A;avascript&#x3A;alert(1))",
      "[x]( javascript:alert(1))",
    ]) {
      expect(renderMarkdown(src), src).not.toContain("href");
    }
  });

  it("still builds ordinary links", () => {
    expect(renderMarkdown("[ok](https://example.org)")).toContain(
      '<a href="https://example.org" title="https://example.org">ok</a>'
    );
  });

  it("keeps a link's own title over the address", () => {
    expect(renderMarkdown('[ok](https://example.org "Home")')).toContain(
      '<a href="https://example.org" title="Home">ok</a>'
    );
  });

  it("survives an empty or missing document", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null as unknown as string)).toBe("");
  });
});

describe("renderMarkdown / highlight", () => {
  it("renders ==text== as <mark>, with inline marks inside", () => {
    expect(renderMarkdown("a ==big **deal**== here")).toContain("a <mark>big <strong>deal</strong></mark> here");
  });
  it("leaves a lone = and === alone", () => {
    expect(renderMarkdown("a = b === c")).not.toContain("<mark>");
  });
});

describe("renderMarkdown / brackets are text", () => {
  // Decided 2026-09-26: GFM task lists are not supported. A to-do is a
  // tagged line; "[ ]" after a bullet is the item's text, as in the editor.
  it("leaves a GFM checkbox as the item's text", () => {
    const html = renderMarkdown("- [ ] milk\n- [x] bread\n1. [X] one");
    expect(html).not.toContain("checkbox");
    expect(html).not.toContain('class="task"');
    expect(html).toContain("[ ] milk");
    expect(html).toContain("[x] bread");
    expect(html).toContain("[X] one");
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

// Images follow Settings › Privacy & Security (25/09). An image the setting
// doesn't allow must never reach an <img>: that is the request the setting is
// there to stop. It shows as a box naming what was held back instead.
describe("images and the privacy setting", () => {
  const remote = "![logo](https://tracker.example/p.gif)";
  const local = "![tram](img/tram.jpg)";
  const imgs = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];

  it("blocks remote images unless everything is allowed", () => {
    for (const images of ["none", "local"] as const) {
      const out = renderMarkdown(remote, { images });
      expect(imgs(out)).toEqual([]);
      expect(out).toContain("Image blocked · tracker.example");
      expect(out).toContain('data-action="privacy-settings"');
    }
    expect(imgs(renderMarkdown(remote, { images: "all" }))[0]).toContain('src="https://tracker.example/p.gif"');
  });

  it("blocks remote images by default", () => {
    expect(imgs(renderMarkdown(remote))).toEqual([]);
  });

  it("loads a local image through the resolver, unless images are off", () => {
    const resolveLocal = (src: string) => `asset://localhost/notes/${src}`;
    const out = renderMarkdown(local, { images: "local", resolveLocal });
    expect(imgs(out)[0]).toContain('src="asset://localhost/notes/img/tram.jpg"');
    expect(imgs(out)[0]).toContain('alt="tram"');
    expect(imgs(renderMarkdown(local, { images: "none", resolveLocal }))).toEqual([]);
    expect(renderMarkdown(local, { images: "none", resolveLocal })).toContain("Image blocked · local image");
  });

  it("blocks a local image the resolver can't place, without a settings link", () => {
    const out = renderMarkdown(local, { images: "all", resolveLocal: () => null });
    expect(imgs(out)).toEqual([]);
    expect(out).toContain("unsupported address");
    expect(out).not.toContain("privacy-settings");
  });

  it("never loads another scheme, whatever the setting", () => {
    for (const images of ["none", "local", "all"] as const) {
      expect(imgs(renderMarkdown("![x](file:///etc/hosts)", { images }))).toEqual([]);
    }
  });

  it("escapes what it puts in the box", () => {
    const out = renderMarkdown('![a"<b>](https://x.example/"onerror="alert(1).png)', { images: "local" });
    expect(out).not.toContain("<b>");
    expect(out).not.toMatch(/onerror="alert/);
  });
});
