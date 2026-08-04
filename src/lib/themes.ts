// Theme registry. Each theme bundles the CodeMirror theme extension plus the
// matching "chrome" colors for the app shell (tab bar, borders, status bar),
// so the whole window feels like one coherent surface.
import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import type { Extension } from "@uiw/react-codemirror";

export interface ThemeChrome {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  tabBg: string;
  tabActiveBg: string;
  accent: string;
}

export interface ThemeDef {
  id: string;
  label: string;
  mode: "light" | "dark";
  cm: Extension;
  chrome: ThemeChrome;
}

export const THEMES: ThemeDef[] = [
  {
    id: "light",
    label: "GitHub Light",
    mode: "light",
    cm: githubLight,
    chrome: {
      bg: "#ffffff",
      fg: "#24292f",
      muted: "#57606a",
      border: "#d0d7de",
      tabBg: "#f6f8fa",
      tabActiveBg: "#ffffff",
      accent: "#0969da",
    },
  },
  {
    id: "dark",
    label: "GitHub Dark",
    mode: "dark",
    cm: githubDark,
    chrome: {
      bg: "#0d1117",
      fg: "#c9d1d9",
      muted: "#8b949e",
      border: "#30363d",
      tabBg: "#161b22",
      tabActiveBg: "#0d1117",
      accent: "#58a6ff",
    },
  },
  {
    id: "tokyo",
    label: "Tokyo Night",
    mode: "dark",
    cm: tokyoNight,
    chrome: {
      bg: "#1a1b26",
      fg: "#a9b1d6",
      muted: "#565f89",
      border: "#292e42",
      tabBg: "#16161e",
      tabActiveBg: "#1a1b26",
      accent: "#7aa2f7",
    },
  },
];

export const DEFAULT_THEME_ID = "light";

export function themeById(id?: string | null): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function nextThemeId(id: string): string {
  const i = THEMES.findIndex((t) => t.id === id);
  return THEMES[(i + 1) % THEMES.length].id;
}
