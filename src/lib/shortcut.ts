// Keyboard shortcuts, in the two forms Parker needs them: the accelerator
// string Tauri registers a global hotkey with, and the ⌘⌥⇧ form a person
// reads. Both are pure string work, and both used to live inside the
// components that happened to need them first.

/** The subset of KeyboardEvent a shortcut is built from. Narrower than the
 *  real event so the rules can be exercised without one. */
export interface KeyChord {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// Build a Tauri accelerator string (e.g. "CmdOrCtrl+Shift+P") from a keydown.
// Returns null for modifier-only presses or combos without a modifier.
const CODE_MAP: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
};

export function accelFromEvent(e: KeyChord): string | null {
  const mods: string[] = [];
  if (e.metaKey) mods.push("CmdOrCtrl");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");

  const code = e.code;
  let key: string | null = null;
  if (code.startsWith("Key")) key = code.slice(3);
  else if (code.startsWith("Digit")) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else key = CODE_MAP[code] ?? null;

  // Need a real (non-modifier) key AND at least one modifier.
  if (!key || mods.length === 0) return null;
  return [...mods, key].join("+");
}

/** Render an accelerator the way a Mac user reads it: "CmdOrCtrl+Shift+P" as
 *  "⌘⇧P". Display only — never parsed back. */
export function prettyShortcut(accel: string): string {
  return accel
    .replace(/CmdOrCtrl|Cmd|Super|Meta/gi, "⌘")
    .replace(/Alt|Option/gi, "⌥")
    .replace(/Shift/gi, "⇧")
    .replace(/Ctrl|Control/gi, "⌃")
    .replace(/\+/g, "");
}
