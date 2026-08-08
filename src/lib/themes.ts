// Theme registry. Each theme bundles the CodeMirror theme extension plus the
// matching "chrome" colors for the app shell (tab bar, borders, status bar),
// so the whole window feels like one coherent surface.
import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import type { Extension } from "@uiw/react-codemirror";

// Content font for the Vercel themes — set on the theme itself so it beats the
// proportional UI font (createTheme would otherwise inherit it).
const MONO =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

// The "mini theme" for everything that is NOT editor content. A canvas tone
// (matches the editor bg) plus three chrome surfaces by elevation, and the key
// semantic colors.
export interface ThemeChrome {
  canvas: string; // content surface — matches the editor background
  surface1: string; // chrome base — tab strip
  surface2: string; // chrome bars — header, status bar
  surface3: string; // elevated — active tab, popovers, hover
  text: string; // primary chrome text
  textMuted: string; // secondary text / icons
  border: string; // hairlines
  accent: string; // interactive / brand accent
  onAccent: string; // text/icon over an accent fill
  danger: string; // destructive / errors
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
    // Pure-black canvas, bright-white text — deliberately high contrast.
    background: "#000000",
    foreground: "#ffffff",
    caret: "#ffffff",
    // Selection & active line share a translucent green accent (no grey);
    // the current line is a touch more visible.
    selection: "rgba(16, 185, 129, 0.32)",
    selectionMatch: "rgba(16, 185, 129, 0.22)",
    lineHighlight: "rgba(16, 185, 129, 0.16)",
    gutterBackground: "#000000",
    gutterForeground: "#52525b",
    fontFamily: MONO,
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
    fontFamily: MONO,
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
      canvas: "#000000",
      surface1: "#0a0a0a",
      surface2: "#151517",
      surface3: "#202023",
      text: "#ededed",
      textMuted: "#7d7d85",
      border: "#26262a",
      accent: "#10b981",
      onAccent: "#03130c",
      danger: "#f87171",
    },
  },
  {
    id: "vercel-day",
    label: "Vercel Day",
    mode: "light",
    cm: vercelDay,
    chrome: {
      canvas: "#ffffff",
      surface1: "#f6f6f7",
      surface2: "#ededee",
      surface3: "#ffffff",
      text: "#18181b",
      textMuted: "#6b6b70",
      border: "#e4e4e7",
      accent: "#10b981",
      onAccent: "#ffffff",
      danger: "#dc2626",
    },
  },
  {
    id: "light",
    label: "GitHub Light",
    mode: "light",
    cm: githubLight,
    chrome: {
      canvas: "#ffffff",
      surface1: "#f6f8fa",
      surface2: "#eaeef2",
      surface3: "#ffffff",
      text: "#24292f",
      textMuted: "#57606a",
      border: "#d0d7de",
      accent: "#0969da",
      onAccent: "#ffffff",
      danger: "#cf222e",
    },
  },
  {
    id: "dark",
    label: "GitHub Dark",
    mode: "dark",
    cm: githubDark,
    chrome: {
      canvas: "#0d1117",
      surface1: "#0d1117",
      surface2: "#161b22",
      surface3: "#21262d",
      text: "#c9d1d9",
      textMuted: "#8b949e",
      border: "#30363d",
      accent: "#58a6ff",
      onAccent: "#0d1117",
      danger: "#f85149",
    },
  },
  {
    id: "tokyo",
    label: "Tokyo Night",
    mode: "dark",
    cm: tokyoNight,
    chrome: {
      canvas: "#1a1b26",
      surface1: "#16161e",
      surface2: "#1e2030",
      surface3: "#292e42",
      text: "#a9b1d6",
      textMuted: "#565f89",
      border: "#292e42",
      accent: "#7aa2f7",
      onAccent: "#1a1b26",
      danger: "#f7768e",
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
