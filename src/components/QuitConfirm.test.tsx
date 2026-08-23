// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuitConfirm } from "./QuitConfirm.tsx";

afterEach(cleanup);

function setup() {
  const onQuit = vi.fn();
  const onCancel = vi.fn();
  render(<QuitConfirm onQuit={onQuit} onCancel={onCancel} />);
  return { onQuit, onCancel, user: userEvent.setup() };
}

describe("QuitConfirm", () => {
  it("asks before quitting", () => {
    setup();
    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(screen.getByText("Quit Parker?")).toBeDefined();
  });

  // The dialog exists to cost one deliberate press, not three. Return has to
  // land on Quit without the user tabbing anywhere first.
  it("puts the keyboard on Quit, so Return confirms", () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Quit" }));
  });

  it("quits on Return", async () => {
    const { onQuit, onCancel, user } = setup();
    await user.keyboard("{Enter}");
    expect(onQuit).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("takes it back on Escape", async () => {
    const { onQuit, onCancel, user } = setup();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onQuit).not.toHaveBeenCalled();
  });

  // The OS sends the menu item again on a second ⌘Q. Without handling it the
  // dialog would just re-arm itself and the app would feel stuck.
  it("takes a second ⌘Q as the answer", async () => {
    const { onQuit, user } = setup();
    await user.keyboard("{Meta>}q{/Meta}");
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("quits and cancels from the buttons", async () => {
    const { onQuit, onCancel, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Quit" }));
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("cancels when the backdrop is clicked", async () => {
    const { onCancel, user } = setup();
    await user.click(document.querySelector(".modal-overlay")!);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // Clicking inside the dialog — to select the text, or a mis-aimed click at
  // its edge — must not read as "not now".
  it("stays put when the dialog itself is clicked", async () => {
    const { onQuit, onCancel, user } = setup();
    await user.click(screen.getByText("Quit Parker?"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
  });

  it("stops listening once it is gone", async () => {
    const { onQuit, user } = setup();
    cleanup();
    await user.keyboard("{Enter}");
    expect(onQuit).not.toHaveBeenCalled();
  });
});
