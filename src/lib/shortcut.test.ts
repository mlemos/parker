import { describe, expect, it } from "vitest";
import { accelFromEvent, prettyShortcut } from "./shortcut.ts";
import type { KeyChord } from "./shortcut.ts";

const chord = (over: Partial<KeyChord>): KeyChord => ({
  code: "",
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("accelFromEvent", () => {
  it("names letter and digit keys by their physical code", () => {
    expect(accelFromEvent(chord({ code: "KeyP", metaKey: true }))).toBe("CmdOrCtrl+P");
    expect(accelFromEvent(chord({ code: "Digit7", ctrlKey: true }))).toBe("Ctrl+7");
  });

  // The code, not the character: on a layout where ⌥P types "π", the physical
  // key is still what the OS registers the hotkey against.
  it("ignores what the key would have typed", () => {
    expect(accelFromEvent(chord({ code: "KeyP", key: "π", altKey: true }))).toBe("Alt+P");
  });

  it("keeps function keys as they are", () => {
    expect(accelFromEvent(chord({ code: "F5", ctrlKey: true }))).toBe("Ctrl+F5");
    expect(accelFromEvent(chord({ code: "F12", altKey: true }))).toBe("Alt+F12");
  });

  it("translates the named and punctuation keys Tauri expects", () => {
    const cases: [string, string][] = [
      ["Space", "Space"],
      ["Enter", "Enter"],
      ["Tab", "Tab"],
      ["Backspace", "Backspace"],
      ["Delete", "Delete"],
      ["ArrowUp", "Up"],
      ["ArrowDown", "Down"],
      ["ArrowLeft", "Left"],
      ["ArrowRight", "Right"],
      ["Minus", "-"],
      ["Equal", "="],
      ["Comma", ","],
      ["Period", "."],
      ["Slash", "/"],
      ["Backslash", "\\"],
      ["Semicolon", ";"],
      ["Quote", "'"],
      ["BracketLeft", "["],
      ["BracketRight", "]"],
      ["Backquote", "`"],
    ];
    for (const [code, expected] of cases)
      expect(accelFromEvent(chord({ code, metaKey: true })), code).toBe(
        `CmdOrCtrl+${expected}`
      );
  });

  it("orders the modifiers the same way every time", () => {
    expect(
      accelFromEvent(
        chord({ code: "KeyK", shiftKey: true, altKey: true, ctrlKey: true, metaKey: true })
      )
    ).toBe("CmdOrCtrl+Ctrl+Alt+Shift+K");
  });

  // A recorder that accepted a bare key would hand the OS a global hotkey that
  // swallows that letter everywhere.
  it("refuses a key with no modifier", () => {
    expect(accelFromEvent(chord({ code: "KeyP" }))).toBeNull();
    expect(accelFromEvent(chord({ code: "F5" }))).toBeNull();
  });

  // Modifiers arrive as their own keydown while the user is still reaching for
  // the letter. Those are not the shortcut yet.
  it("refuses a modifier on its own", () => {
    for (const code of ["MetaLeft", "ShiftRight", "AltLeft", "ControlLeft"])
      expect(accelFromEvent(chord({ code, metaKey: true, shiftKey: true })), code).toBeNull();
  });

  it("refuses a key it has no name for", () => {
    expect(accelFromEvent(chord({ code: "IntlYen", metaKey: true }))).toBeNull();
    expect(accelFromEvent(chord({ code: "", metaKey: true }))).toBeNull();
  });
});

describe("prettyShortcut", () => {
  it("renders the modifiers as their symbols, with nothing between", () => {
    expect(prettyShortcut("CmdOrCtrl+Shift+P")).toBe("⌘⇧P");
    expect(prettyShortcut("Ctrl+Alt+P")).toBe("⌃⌥P");
    expect(prettyShortcut("Alt+Space")).toBe("⌥Space");
    expect(prettyShortcut("CmdOrCtrl+,")).toBe("⌘,");
  });

  it("accepts the spellings that mean the same modifier", () => {
    for (const s of ["Cmd+P", "Super+P", "Meta+P", "CmdOrCtrl+P"])
      expect(prettyShortcut(s), s).toBe("⌘P");
    expect(prettyShortcut("Option+P")).toBe("⌥P");
    expect(prettyShortcut("Control+P")).toBe("⌃P");
  });

  it("round-trips what the recorder produces", () => {
    const accel = accelFromEvent(
      chord({ code: "KeyP", metaKey: true, altKey: true, shiftKey: true })
    );
    expect(prettyShortcut(accel!)).toBe("⌘⌥⇧P");
  });
});
