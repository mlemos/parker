// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGroup } from "../lib/layout.ts";
import type { Buffer } from "../lib/layout.ts";
import { themeById } from "../lib/themes.ts";
import { EditorGroup } from "./EditorGroup.tsx";
import type { GroupCallbacks } from "./EditorGroup.tsx";

// The pane's chrome is what these cover — tabs, bars, drop targets. The
// editor inside is CodeMirror and has its own tests; here it is a stand-in
// that says which note it was given.
vi.mock("./Editor", () => ({
  Editor: ({ tab }: { tab: string }) => <div data-testid="editor" data-tab={tab} />,
}));
vi.mock("./MarkdownPreview", () => ({ MarkdownPreview: () => <div /> }));
vi.mock("../lib/lang", () => ({ languageForName: async () => [] }));

afterEach(cleanup);

const buf = (name: string, content = ""): Buffer => ({ name, content, disk: content, dirty: false });

const OUTSIDE = "/Volumes/work/repo/README.md";

function setup(tabs: string[], active: string, extra: Partial<Buffer>[] = []) {
  const cb: GroupCallbacks = {
    onFocus: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNewTab: vi.fn(),
    onChange: vi.fn(),
    onStartRename: vi.fn(),
    onCommitRename: vi.fn(),
    onCancelRename: vi.fn(),
    onSplit: vi.fn(),
    onMerge: vi.fn(),
    onToggleMode: vi.fn(),
    onPreviewToSide: vi.fn(),
    onDropTab: vi.fn(),
    onTabDragStart: vi.fn(),
    onTabDragEnd: vi.fn(),
    onFileDragOver: vi.fn(),
    onCloseGroup: vi.fn(),
    onResolveConflict: vi.fn(),
    onReveal: vi.fn(),
  };
  const buffers = tabs.map((t) => ({ ...buf(t), ...extra.find((e) => e.name === t) }));
  const view = render(
    <EditorGroup
      group={makeGroup(tabs, active)}
      buffers={buffers}
      focused
      canClose={false}
      altHeld={false}
      dragging={false}
      fileDragging={false}
      theme={themeById()}
      gutterOn={false}
      wrapOn
      width={100}
      previewSync
      renamingName={null}
      homeDir="/Volumes/work"
      cb={cb}
    />
  );
  return { cb, ...view };
}

describe("a file from outside the notes folder", () => {
  it("shows only its filename on the tab, and the whole path on hover", () => {
    setup(["a.md", OUTSIDE], OUTSIDE);
    const tab = screen.getByText("README.md").closest(".tab")!;
    expect(tab.getAttribute("title")).toContain(OUTSIDE);
    expect(tab.getAttribute("title")).not.toContain("rename");
  });

  it("gets the band, with the path as ~/… and a way to the Finder", () => {
    const { cb, container } = setup(["a.md", OUTSIDE], OUTSIDE);
    const bar = container.querySelector(".outside-bar")!;
    expect(bar).not.toBeNull();
    expect(bar.textContent).toContain("External");
    expect(screen.getByLabelText("External file — show in Finder").getAttribute("title")).toContain(
      "Outside your notes folder"
    );
    expect(bar.querySelector(".pathlabel")!.textContent).toBe("~/repo/README.md");
    fireEvent.click(screen.getByLabelText("External file — show in Finder"));
    expect(cb.onReveal).toHaveBeenCalledWith(OUTSIDE);
  });

  it("is a band only while that file is the active tab", () => {
    const { container } = setup(["a.md", OUTSIDE], "a.md");
    expect(container.querySelector(".outside-bar")).toBeNull();
    expect(screen.getByText("README.md")).toBeDefined(); // still a tab
  });
});

describe("a note", () => {
  it("offers rename on its tab and gets no band", () => {
    const { container } = setup(["a.md"], "a.md");
    const tab = screen.getByText("a.md").closest(".tab")!;
    expect(tab.getAttribute("title")).toContain("rename");
    expect(container.querySelector(".outside-bar")).toBeNull();
  });
});

describe("a note in a subfolder", () => {
  it("shows only its filename on the tab, and the folder on hover", () => {
    setup(["backlogs/parker.md"], "backlogs/parker.md");
    const tab = screen.getByText("parker.md").closest(".tab")!;
    expect(tab.getAttribute("title")).toContain("backlogs/parker.md");
    expect(tab.getAttribute("title")).toContain("rename");
  });

  it("is not an outside file: no band", () => {
    const { container } = setup(["backlogs/parker.md"], "backlogs/parker.md");
    expect(container.querySelector(".outside-bar")).toBeNull();
  });
});

describe("the empty pane", () => {
  it("offers a file drop, and a tab drop only when there is a tab somewhere", () => {
    const { rerender, cb } = setup([], null as unknown as string);
    expect(screen.getByText(/drop a file here/).textContent).not.toContain("tab");
    rerender(
      <EditorGroup
        group={makeGroup([], null)}
        buffers={[buf("elsewhere.md")]}
        focused
        canClose
        altHeld={false}
        dragging={false}
        fileDragging={false}
        theme={themeById()}
        gutterOn={false}
        wrapOn
        width={100}
        previewSync
        renamingName={null}
        homeDir=""
        cb={cb}
      />
    );
    expect(screen.getByText(/drop a tab or a file here/)).toBeDefined();
  });
});

describe("a file dragged over the pane", () => {
  const files = { types: ["Files"], dropEffect: "none" };

  it("is reported to the pane, and the strip points past the last tab", () => {
    const { cb, container } = setup(["a.md", "b.md"], "a.md");
    fireEvent.dragOver(container.querySelector(".tabs")!, { dataTransfer: files });
    expect(cb.onFileDragOver).toHaveBeenCalledWith();
    expect(container.querySelector(".tabs")!.className).not.toContain("drop-end");
  });

  it("over a tab, is reported with that tab's index", () => {
    const { cb } = setup(["a.md", "b.md"], "a.md");
    fireEvent.dragOver(screen.getByText("b.md").closest(".tab")!, { dataTransfer: files });
    expect(cb.onFileDragOver).toHaveBeenCalledWith(1);
  });

  it("is not a tab drag: the tab strip's own handlers leave it alone", () => {
    const { cb } = setup(["a.md"], "a.md");
    fireEvent.drop(screen.getByText("a.md").closest(".tab")!, {
      dataTransfer: { ...files, getData: () => "" },
    });
    expect(cb.onDropTab).not.toHaveBeenCalled();
  });
});
