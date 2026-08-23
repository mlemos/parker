// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteHit } from "../lib/api.ts";
import { NotePicker } from "./NotePicker.tsx";

// The picker talks to the backend for search and delete. That module is the
// single seam over every `invoke`, so mocking it is all it takes to run the
// component with no Tauri underneath.
vi.mock("../lib/api", () => ({
  api: { searchNotes: vi.fn(), deleteNote: vi.fn() },
}));
import { api } from "../lib/api.ts";

const searchNotes = vi.mocked(api.searchNotes);
const deleteNote = vi.mocked(api.deleteNote);

const hit = (name: string, over: Partial<NoteHit> = {}): NoteHit => ({
  name,
  modified: Math.floor(Date.now() / 1000),
  in_name: true,
  snippet: null,
  ...over,
});

const HITS = [hit("alpha.md"), hit("beta.md"), hit("gamma.md")];

afterEach(cleanup);

beforeEach(() => {
  searchNotes.mockResolvedValue(HITS);
  deleteNote.mockResolvedValue(undefined);
});

function setup(openNames: string[] = []) {
  const onOpen = vi.fn();
  const onDeleted = vi.fn();
  const onClose = vi.fn();
  render(
    <NotePicker
      openNames={openNames}
      onOpen={onOpen}
      onDeleted={onDeleted}
      onClose={onClose}
    />
  );
  return { onOpen, onDeleted, onClose, user: userEvent.setup() };
}

const rows = () => Array.from(document.querySelectorAll(".picker-item"));
const selected = () => document.querySelector(".picker-item.sel");
const input = () => screen.getByPlaceholderText(/Search notes/i);
const listed = async (n: number) => waitFor(() => expect(rows()).toHaveLength(n));

describe("NotePicker", () => {
  it("takes the keyboard on open, so you can just type", async () => {
    setup();
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it("lists everything before you type anything", async () => {
    setup();
    await listed(3);
    expect(screen.getByText("alpha.md")).toBeDefined();
  });

  it("says so when nothing matches", async () => {
    searchNotes.mockResolvedValue([]);
    setup();
    await waitFor(() => expect(screen.getByText("No matches")).toBeDefined());
  });

  it("searches for what you type", async () => {
    const { user } = setup();
    await listed(3);
    await user.type(input(), "bet");
    await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("bet"));
  });

  // Every keystroke firing its own request is what makes a search field feel
  // heavy; only the pause the user takes should reach the backend.
  it("waits for a pause before searching", async () => {
    const { user } = setup();
    await listed(3);
    searchNotes.mockClear();
    await user.type(input(), "abc");
    expect(searchNotes).not.toHaveBeenCalled();
    await waitFor(() => expect(searchNotes).toHaveBeenCalledTimes(1));
    expect(searchNotes).toHaveBeenCalledWith("abc");
  });

  // Responses come back in whatever order the backend finishes them. A slow
  // answer to an old query must not land on top of a newer one, or the list
  // stops matching the box.
  it("ignores an answer that arrives after a newer search", async () => {
    let releaseStale: (hits: NoteHit[]) => void = () => {};
    searchNotes.mockImplementationOnce(
      () => new Promise((res) => (releaseStale = res))
    );
    const { user } = setup();
    await user.type(input(), "x");

    searchNotes.mockResolvedValue([hit("fresh.md")]);
    await user.type(input(), "y");
    await waitFor(() => expect(screen.getByText("fresh.md")).toBeDefined());

    releaseStale([hit("stale.md")]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("stale.md")).toBeNull();
    expect(screen.getByText("fresh.md")).toBeDefined();
  });

  describe("keyboard navigation", () => {
    it("starts on the first result", async () => {
      setup();
      await listed(3);
      expect(selected()!.textContent).toContain("alpha.md");
    });

    it("moves down and up", async () => {
      const { user } = setup();
      await listed(3);
      await user.keyboard("{ArrowDown}{ArrowDown}");
      expect(selected()!.textContent).toContain("gamma.md");
      await user.keyboard("{ArrowUp}");
      expect(selected()!.textContent).toContain("beta.md");
    });

    // Wrapping in a filtered list means holding an arrow key silently loops
    // you back past what you were reading.
    it("stops at both ends instead of wrapping", async () => {
      const { user } = setup();
      await listed(3);
      await user.keyboard("{ArrowUp}{ArrowUp}");
      expect(selected()!.textContent).toContain("alpha.md");
      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
      expect(selected()!.textContent).toContain("gamma.md");
    });

    it("opens the selection on Return", async () => {
      const { onOpen, user } = setup();
      await listed(3);
      await user.keyboard("{ArrowDown}{Enter}");
      expect(onOpen).toHaveBeenCalledWith("beta.md");
    });

    it("closes on Escape", async () => {
      const { onClose, user } = setup();
      await listed(3);
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("re-selects from the top when the search changes", async () => {
      const { user } = setup();
      await listed(3);
      await user.keyboard("{ArrowDown}{ArrowDown}");
      searchNotes.mockResolvedValue([hit("only.md"), hit("other.md")]);
      await user.type(input(), "o");
      await waitFor(() => expect(selected()!.textContent).toContain("only.md"));
    });
  });

  describe("the mouse", () => {
    it("opens the note you click", async () => {
      const { onOpen, user } = setup();
      await listed(3);
      await user.click(rows()[2]);
      expect(onOpen).toHaveBeenCalledWith("gamma.md");
    });

    it("follows the pointer with the selection", async () => {
      const { user } = setup();
      await listed(3);
      await user.hover(rows()[1]);
      expect(selected()!.textContent).toContain("beta.md");
    });

    it("closes when you click outside it", async () => {
      const { onClose, user } = setup();
      await listed(3);
      await user.click(document.querySelector(".picker-overlay")!);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("deleting", () => {
    it("asks before moving a note to the Trash", async () => {
      const { onDeleted, user } = setup();
      await listed(3);
      await user.keyboard("{Meta>}{Backspace}{/Meta}");
      expect(screen.getByText("Move to Trash?")).toBeDefined();
      expect(deleteNote).not.toHaveBeenCalled();
      expect(onDeleted).not.toHaveBeenCalled();
    });

    it("deletes on Return once it has asked", async () => {
      const { onDeleted, user } = setup();
      await listed(3);
      await user.keyboard("{Meta>}{Backspace}{/Meta}{Enter}");
      await waitFor(() => expect(deleteNote).toHaveBeenCalledWith("alpha.md"));
      expect(onDeleted).toHaveBeenCalledWith("alpha.md");
      await waitFor(() => expect(screen.queryByText("alpha.md")).toBeNull());
    });

    // Escape here means "not that", not "close the picker" — the question is
    // what's in front of you, and dismissing it should leave you searching.
    it("takes back the question on Escape without closing the picker", async () => {
      const { onClose, user } = setup();
      await listed(3);
      await user.keyboard("{Meta>}{Backspace}{/Meta}{Escape}");
      expect(screen.queryByText("Move to Trash?")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(deleteNote).not.toHaveBeenCalled();
    });

    it("arms the question from the row's trash button", async () => {
      const { user } = setup();
      await listed(3);
      await user.click(within(rows()[1] as HTMLElement).getByLabelText("Move to Trash"));
      expect(within(rows()[1] as HTMLElement).getByText("Move to Trash?")).toBeDefined();
      expect(selected()!.textContent).toContain("beta.md");
    });

    // The row is a click-to-open target everywhere else; while it is asking,
    // that would open the note you just said to delete.
    it("does not open the note while its row is asking", async () => {
      const { onOpen, user } = setup();
      await listed(3);
      await user.keyboard("{Meta>}{Backspace}{/Meta}");
      await user.click(rows()[0]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it("keeps the note when the delete fails", async () => {
      deleteNote.mockRejectedValue(new Error("busy"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { onDeleted, user } = setup();
      await listed(3);
      await user.keyboard("{Meta>}{Backspace}{/Meta}{Enter}");
      await waitFor(() => expect(deleteNote).toHaveBeenCalled());
      expect(onDeleted).not.toHaveBeenCalled();
      expect(screen.getByText("alpha.md")).toBeDefined();
    });
  });

  describe("what each row shows", () => {
    it("marks the notes already open", async () => {
      setup(["beta.md"]);
      await listed(3);
      expect(within(rows()[1] as HTMLElement).getByText("open")).toBeDefined();
      expect(within(rows()[0] as HTMLElement).queryByText("open")).toBeNull();
    });

    it("shows the line a content match came from", async () => {
      searchNotes.mockResolvedValue([
        hit("notes.md", { in_name: false, snippet: "the matching line" }),
      ]);
      setup();
      await waitFor(() => expect(screen.getByText(/the matching line/)).toBeDefined());
    });

    it("highlights the match inside the name", async () => {
      searchNotes.mockResolvedValue([hit("alpha.md")]);
      const { user } = setup();
      await listed(1);
      await user.type(input(), "PHA");
      await waitFor(() => {
        const mark = document.querySelector(".picker-mark");
        expect(mark?.textContent).toBe("pha"); // matched case-insensitively
      });
    });
  });
});
