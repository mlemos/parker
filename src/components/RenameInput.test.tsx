// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameInput } from "./RenameInput.tsx";

afterEach(cleanup);

describe("RenameInput", () => {
  // Renaming a symlinked note renames the link; the file keeps its name.
  it("says what a rename acts on when there is something to say", () => {
    render(<RenameInput initial="work.md" onCommit={vi.fn()} onCancel={vi.fn()} hint="Renames the link." />);
    expect(screen.getByRole("note").textContent).toBe("Renames the link.");
  });

  it("says nothing for an ordinary note", () => {
    render(<RenameInput initial="work.md" onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
