# Parker

A fast, minimal desktop editor for **notes, code and markdown** — a serious scratchpad for working with AI: drafting long prompts, task lists, and quick snippets, without the weight and clutter of Notes, VS Code, and friends.

## Principles

- **Fast** — instant to open, zero lag while typing, no splash, no "syncing…".
- **Keyboard-first** — almost everything reachable without the mouse.
- **Lightweight** — no ribbon of icons, no formatting toolbar, no bloat.
- **Reliable** — never lose data (aggressive auto-save; optional git history).
- **Themeable** — light/dark and beyond.
- **Your data, your rules** — plain files on disk in a folder you own. Sync however you like (iCloud, Dropbox, git). No servers of ours, ever.

## Stack

- **[Tauri 2](https://tauri.app/)** — tiny, fast native shell (Rust backend + system webview).
- **React + TypeScript** — the UI.
- **[CodeMirror 6](https://codemirror.dev/)** — world-class editing, syntax highlighting, themes.

## Development

Prerequisites: [Rust](https://rustup.rs/), [Node](https://nodejs.org/) + [pnpm](https://pnpm.io/).

```bash
pnpm install       # install frontend deps
pnpm tauri dev     # run the app (compiles Rust the first time — be patient)
pnpm tauri build   # produce a distributable .app / .dmg
```

## Status

Early. MVP scope: editor + tabs + auto-save + themes.
