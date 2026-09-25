// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGroup, noteOf } from "../lib/layout.ts";
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
vi.mock("./MarkdownPreview", () => ({ MarkdownPreview: () => <div data-testid="preview" /> }));
vi.mock("../lib/lang", () => ({ languageForName: async () => [] }));

afterEach(cleanup);

const buf = (name: string, content = ""): Buffer => ({ name, content, disk: content, dirty: false });

const OUTSIDE = "/Volumes/work/repo/README.md";

type NoteWindow = { onTop: boolean; onToggleTop: () => void; onDockBack: () => void };

function setup(
  tabs: string[],
  active: string,
  extra: Partial<Buffer>[] = [],
  noteWindow?: NoteWindow
) {
  const cb: GroupCallbacks = {
    onFocus: vi.fn(),
    onSelectTab: vi.fn(),
    onDeselectTab: vi.fn(),
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
    onSaveGone: vi.fn(),
    onReveal: vi.fn(),
    onPopOut: vi.fn(),
    onDragOut: vi.fn(),
  };
  const notes = [...new Set(tabs.map(noteOf))];
  const buffers = notes.map((t) => ({ ...buf(t), ...extra.find((e) => e.name === t) }));
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
      noteWindow={noteWindow}
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

describe("a preview tab", () => {
  it("shows the note rendered, wears the eye, and is named after the note", () => {
    const { container } = setup(["a.md", "preview:a.md"], "preview:a.md", [
      { name: "a.md", content: "# Title" },
    ]);
    expect(container.querySelector('[data-testid="preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="editor"]')).toBeNull();
    const tab = container.querySelector(".tab.preview")!;
    expect(tab.querySelector(".tab-eye")).not.toBeNull();
    expect(tab.querySelector(".tab-name")!.textContent).toBe("a.md");
    expect(tab.getAttribute("title")).toBe("Preview of a.md");
  });

  it("closes by its own id, not the note's", () => {
    const { cb, container } = setup(["a.md", "preview:a.md"], "a.md");
    fireEvent.click(container.querySelector(".tab.preview .tab-close")!);
    expect(cb.onCloseTab).toHaveBeenCalledWith("preview:a.md");
  });
});

describe("the tab strip", () => {
  it("puts no tab in front when its empty space is clicked", () => {
    const { cb, container } = setup(["a.md"], "a.md");
    fireEvent.click(container.querySelector(".tabs")!);
    expect(cb.onDeselectTab).toHaveBeenCalled();
    // a click on a tab is a select, never a deselect
    fireEvent.click(screen.getByText("a.md").closest(".tab")!);
    expect(cb.onDeselectTab).toHaveBeenCalledTimes(1);
    expect(cb.onSelectTab).toHaveBeenCalledWith("a.md");
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

// ---- A window of its own ------------------------------------------------------

describe("a tab dragged out of the window", () => {
  const nowhere = { types: ["application/x-parker-tab"], dropEffect: "none" };

  it("is reported when the drag ends with nothing taking it", () => {
    const { cb } = setup(["a.md", "b.md"], "a.md");
    fireEvent.dragEnd(screen.getByText("b.md").closest(".tab")!, { dataTransfer: nowhere });
    expect(cb.onDragOut).toHaveBeenCalledWith("b.md");
    expect(cb.onTabDragEnd).toHaveBeenCalled();
  });

  it("is not reported when something took the drop", () => {
    const { cb } = setup(["a.md"], "a.md");
    fireEvent.dragEnd(screen.getByText("a.md").closest(".tab")!, {
      dataTransfer: { ...nowhere, dropEffect: "move" },
    });
    expect(cb.onDragOut).not.toHaveBeenCalled();
  });
});

describe("the pane of a note window", () => {
  const win = () => ({ onTop: false, onToggleTop: vi.fn(), onDockBack: vi.fn() });

  it("has the one tab, and no way to add, split or drag", () => {
    const { container } = setup(["a.md"], "a.md", [], win());
    expect(container.querySelector(".tab-new")).toBeNull();
    expect(screen.queryByLabelText(/split/i)).toBeNull();
    expect(screen.queryByLabelText("Open in new window")).toBeNull();
    expect(screen.getByText("a.md").closest(".tab")!.getAttribute("draggable")).toBe("false");
    expect(screen.getByTitle("Close window (Cmd+W)")).toBeTruthy();
  });

  it("carries the window's own controls: preview, pin, and the way back", () => {
    const w = win();
    const { cb } = setup(["a.md"], "a.md", [], w);
    expect(screen.getByLabelText("Preview")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Keep on top"));
    expect(w.onToggleTop).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Move back to the main window"));
    expect(w.onDockBack).toHaveBeenCalled();
    expect(cb.onSplit).not.toHaveBeenCalled();
  });

  it("shows the pin pressed while the window is on top", () => {
    setup(["a.md"], "a.md", [], { ...win(), onTop: true });
    const pin = screen.getByLabelText("Keep on top");
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(pin.className).toContain("on");
  });

  it("never reports a drag out: there is nowhere for the tab to go", () => {
    const { cb } = setup(["a.md"], "a.md", [], win());
    fireEvent.dragEnd(screen.getByText("a.md").closest(".tab")!, {
      dataTransfer: { types: [], dropEffect: "none" },
    });
    expect(cb.onDragOut).not.toHaveBeenCalled();
  });
});

describe("the pane of the main window", () => {
  it("offers to open the note in a window of its own", () => {
    const { cb } = setup(["a.md"], "a.md");
    fireEvent.click(screen.getByLabelText("Open in new window"));
    expect(cb.onPopOut).toHaveBeenCalled();
  });

  it("has nothing to pop out when it is empty", () => {
    setup([], "");
    expect(screen.queryByLabelText("Open in new window")).toBeNull();
  });
});

describe("a note whose file is gone", () => {
  it("says so, and offers to close the tab or save it again", () => {
    const { cb, container } = setup(["a.md", "b.md"], "a.md", [{ name: "a.md", gone: true }]);
    const bar = container.querySelector(".conflict-bar")!;
    expect(bar.textContent).toContain("deleted or moved outside Parker");
    fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
    expect(cb.onCloseTab).toHaveBeenCalledWith("a.md");
    fireEvent.click(screen.getByRole("button", { name: "Save it again" }));
    expect(cb.onSaveGone).toHaveBeenCalledWith("a.md");
  });

  it("says nothing for a note that is on disk", () => {
    const { container } = setup(["a.md"], "a.md");
    expect(container.querySelector(".conflict-bar")).toBeNull();
  });

  it("leaves a conflict to its own bar", () => {
    const { container } = setup(["a.md"], "a.md", [{ name: "a.md", gone: true, conflict: { disk: "x" } }]);
    const bars = container.querySelectorAll(".conflict-bar");
    expect(bars.length).toBe(1);
    expect(bars[0].textContent).toContain("Changed on disk");
  });
});
