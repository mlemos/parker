// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { themeById } from "../lib/themes.ts";
import { cursorOf, forgetPosition, onCursor, viewportOf } from "../lib/preview-sync.ts";
import { Editor } from "./Editor.tsx";

vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});

afterEach(() => {
  cleanup();
  forgetPosition("n.md");
});

const flushFrames = async () => {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

describe("the editor tells the preview where it is", () => {
  it("posts the cursor and viewport on mount", async () => {
    render(
      <Editor
        tab="n.md"
        tabs={["n.md"]}
        content={"one\ntwo\nthree"}
        focused
        theme={themeById()}
        gutterOn={false}
        wrapOn
        width={100}
        langExt={[]}
        changed={undefined}
        onChange={() => {}}
      />
    );
    await flushFrames();
    expect(cursorOf("n.md")).toMatchObject({ name: "n.md", line: 1, from: 1, to: 1 });
    expect(viewportOf("n.md")).toMatchObject({ name: "n.md", top: 1 });
  });

  it("posts again when the selection moves", async () => {
    const { getActiveView } = await import("../lib/latency.ts");
    const seen: number[] = [];
    const off = onCursor("n.md", (p) => seen.push(p.line));
    render(
      <Editor
        tab="n.md"
        tabs={["n.md"]}
        content={"one\ntwo\nthree"}
        focused
        theme={themeById()}
        gutterOn={false}
        wrapOn
        width={100}
        langExt={[]}
        changed={undefined}
        onChange={() => {}}
      />
    );
    await flushFrames();
    // A transaction, not a key: a keyboard move asks CodeMirror to scroll
    // the cursor into view, which measures the DOM — and jsdom has none.
    act(() => getActiveView()!.dispatch({ selection: { anchor: 5 } }));
    await flushFrames();
    off();
    expect(seen[seen.length - 1]).toBe(2);
  });
});

describe("text replaced from outside", () => {
  it("keeps the caret where it was and does not select the whole document", async () => {
    const { getActiveView } = await import("../lib/latency.ts");
    const props = {
      tab: "n.md",
      tabs: ["n.md"],
      focused: true,
      theme: themeById(),
      gutterOn: false,
      wrapOn: true,
      width: 100 as const,
      langExt: [],
      changed: undefined,
      onChange: () => {},
    };
    const { rerender } = render(<Editor {...props} content={"one\ntwo\nthree"} />);
    await flushFrames();
    const v = getActiveView()!;
    // A selection over "two" — the case that used to become everything.
    act(() => v.dispatch({ selection: { anchor: 4, head: 7 } }));
    rerender(<Editor {...props} content={"one\nTWO\nthree\nfour"} />);
    const sel = v.state.selection.main;
    expect(sel.empty).toBe(true);
    expect(sel.head).toBe(7);
    expect(v.state.doc.toString()).toBe("one\nTWO\nthree\nfour");
  });

  it("clamps the caret when the new text is shorter", async () => {
    const { getActiveView } = await import("../lib/latency.ts");
    const props = {
      tab: "n.md",
      tabs: ["n.md"],
      focused: true,
      theme: themeById(),
      gutterOn: false,
      wrapOn: true,
      width: 100 as const,
      langExt: [],
      changed: undefined,
      onChange: () => {},
    };
    const { rerender } = render(<Editor {...props} content={"one\ntwo\nthree"} />);
    await flushFrames();
    const v = getActiveView()!;
    act(() => v.dispatch({ selection: { anchor: 12 } }));
    rerender(<Editor {...props} content={"one"} />);
    expect(v.state.selection.main.head).toBe(3);
  });
});
