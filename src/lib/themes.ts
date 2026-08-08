// Theme registry. Each theme bundles the CodeMirror theme extension plus the
// matching "chrome" colors for the app shell (tab bar, borders, status bar),
// so the whole window feels like one coherent surface.
import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
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

// ---- Vercel-inspired monochrome themes -----------------------------------
// Syntax is differentiated by brightness and weight, never by hue — the whole
// spectrum runs black→white through Tailwind's Zinc scale.

interface Mono {
  comment: string;
  keyword: string;
  string: string;
  number: string;
  func: string;
  variable: string;
  type: string;
  punct: string;
  heading: string;
  emphasis: string;
  link: string;
  invalid: string;
}

function monoStyles(p: Mono) {
  return [
    {
      tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
      color: p.comment,
      fontStyle: "italic",
    },
    {
      tag: [
        t.keyword,
        t.modifier,
        t.controlKeyword,
        t.operatorKeyword,
        t.definitionKeyword,
        t.moduleKeyword,
      ],
      color: p.keyword,
      fontWeight: "600",
    },
    { tag: [t.string, t.special(t.string), t.regexp], color: p.string },
    { tag: [t.number, t.bool, t.null, t.atom], color: p.number },
    {
      tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName],
      color: p.func,
    },
    {
      tag: [t.variableName, t.propertyName, t.attributeName, t.attributeValue],
      color: p.variable,
    },
    {
      tag: [t.typeName, t.className, t.namespace, t.tagName],
      color: p.type,
      fontWeight: "600",
    },
    {
      tag: [
        t.operator,
        t.punctuation,
        t.separator,
        t.bracket,
        t.paren,
        t.brace,
        t.derefOperator,
      ],
      color: p.punct,
    },
    {
      tag: [
        t.heading,
        t.heading1,
        t.heading2,
        t.heading3,
        t.heading4,
        t.heading5,
        t.heading6,
      ],
      color: p.heading,
      fontWeight: "700",
    },
    { tag: [t.strong], color: p.heading, fontWeight: "700" },
    { tag: [t.emphasis], color: p.emphasis, fontStyle: "italic" },
    { tag: [t.link, t.url], color: p.link, textDecoration: "underline" },
    { tag: [t.quote], color: p.string },
    { tag: [t.monospace], color: p.number },
    { tag: [t.list, t.meta, t.processingInstruction], color: p.punct },
    { tag: [t.invalid], color: p.invalid },
  ];
}

const vercelNight = createTheme({
  theme: "dark",
  settings: {
    background: "#09090b",
    // Pure white body text + caret — Vercel Night is deliberately high
    // contrast: what you type reads bright white on near-black.
    foreground: "#ffffff",
    caret: "#ffffff",
    selection: "#27272a",
    selectionMatch: "#3f3f46",
    lineHighlight: "#ffffff0a",
    gutterBackground: "#09090b",
    gutterForeground: "#52525b",
    fontFamily: "inherit",
  },
  styles: monoStyles({
    comment: "#52525b", // zinc-600
    keyword: "#ffffff", // white
    string: "#a1a1aa", // zinc-400
    number: "#d4d4d8", // zinc-300
    func: "#f4f4f5", // zinc-100
    variable: "#ffffff", // white — plain text / identifiers you write
    type: "#ffffff",
    punct: "#71717a", // zinc-500
    heading: "#ffffff",
    emphasis: "#d4d4d8",
    link: "#a1a1aa",
    invalid: "#f87171",
  }),
});

const vercelDay = createTheme({
  theme: "light",
  settings: {
    background: "#ffffff",
    foreground: "#18181b",
    caret: "#18181b",
    selection: "#e4e4e7",
    selectionMatch: "#d4d4d8",
    lineHighlight: "#00000008",
    gutterBackground: "#ffffff",
    gutterForeground: "#a1a1aa",
    fontFamily: "inherit",
  },
  styles: monoStyles({
    comment: "#a1a1aa", // zinc-400
    keyword: "#09090b", // zinc-950
    string: "#52525b", // zinc-600
    number: "#3f3f46", // zinc-700
    func: "#18181b", // zinc-900
    variable: "#27272a", // zinc-800
    type: "#09090b",
    punct: "#a1a1aa",
    heading: "#09090b",
    emphasis: "#3f3f46",
    link: "#52525b",
    invalid: "#dc2626",
  }),
});

export const THEMES: ThemeDef[] = [
  {
    id: "vercel-night",
    label: "Vercel Night",
    mode: "dark",
    cm: vercelNight,
    chrome: {
      bg: "#09090b",
      fg: "#e4e4e7",
      muted: "#71717a",
      border: "#27272a",
      tabBg: "#09090b",
      tabActiveBg: "#18181b",
      accent: "#fafafa",
    },
  },
  {
    id: "vercel-day",
    label: "Vercel Day",
    mode: "light",
    cm: vercelDay,
    chrome: {
      bg: "#ffffff",
      fg: "#18181b",
      muted: "#71717a",
      border: "#e4e4e7",
      tabBg: "#fafafa",
      tabActiveBg: "#ffffff",
      accent: "#18181b",
    },
  },
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

export const DEFAULT_THEME_ID = "vercel-night";

export function themeById(id?: string | null): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function nextThemeId(id: string): string {
  const i = THEMES.findIndex((t) => t.id === id);
  return THEMES[(i + 1) % THEMES.length].id;
}
