// Theme registry. Two layers:
//   1. Base palette  → Tailwind color scales (see palette.ts).
//   2. Named UI roles → every themeable AREA of the app (ThemeUI), each mapped
//      onto a palette color. So a theme reads area-by-area ("header = zinc-900,
//      active tab = zinc-800, accent = emerald-500").
// The editor (CodeMirror) content theme is derived from the same tokens for
// Parker's native themes, so chrome and content stay in sync.
import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
import type { Extension } from "@uiw/react-codemirror";
import { tw, alpha } from "./palette";

// Every themeable area of Parker, by name.
export interface ThemeUI {
  // Editor — the content surface
  editorBg: string; // editor background (the writing canvas)
  editorFg: string; // editor text
  currentLine: string; // active-line highlight
  selection: string; // text selection
  // Title bar
  headerBg: string; // the top bar (distinct tone)
  fieldBg: string; // the search field inside the header
  // Tabs
  tabbarBg: string; // the tab strip
  tabActiveBg: string; // the active tab
  // Status bar
  statusBg: string; // the bottom bar
  // Floating surfaces
  popoverBg: string; // ⌘O picker & Settings panel
  // Shared roles — three text/icon tiers by legibility
  text: string; // primary text (active tab, titles)
  secondary: string; // readable chrome fg: icons, status text, inactive tabs, field
  muted: string; // faint text: hints, subtitles, folder path, placeholder
  border: string; // hairlines
  accent: string; // current line, selection, dirty dot, focus, primary button
  onAccent: string; // text/icon over an accent fill
  danger: string; // errors / destructive
}

export interface ThemeDef {
  id: string;
  label: string;
  mode: "light" | "dark";
  cm: Extension;
  ui: ThemeUI; // chrome roles
  syntax: SyntaxColors; // editor content roles
}

const MONO =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

// ---- Editor content colors (syntax) --------------------------------------
// Named roles for what you write. Parker's own themes are monochrome
// (brightness/weight, not hue) built on Tailwind's zinc scale.
export interface SyntaxColors {
  plain: string; // body text / identifiers
  heading: string; // markdown headings & strong
  keyword: string; // keywords, tags
  string: string; // strings, regex
  number: string; // numbers, booleans, constants
  func: string; // function / type / class names
  comment: string; // comments, block quotes
  punct: string; // operators, punctuation, brackets
  link: string; // links / urls
  invalid: string; // errors
}

function monoStyles(p: SyntaxColors) {
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
      tag: [
        t.variableName,
        t.definition(t.variableName),
        t.local(t.variableName),
        t.propertyName,
        t.definition(t.propertyName),
        t.attributeName,
        t.attributeValue,
      ],
      color: p.plain,
    },
    {
      tag: [t.typeName, t.className, t.namespace, t.tagName],
      color: p.func,
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
    { tag: [t.emphasis], color: p.plain, fontStyle: "italic" },
    { tag: [t.link, t.url], color: p.link },
    { tag: [t.quote], color: p.string },
    { tag: [t.monospace], color: p.number },
    { tag: [t.list, t.meta, t.processingInstruction], color: p.punct },
    { tag: [t.invalid], color: p.invalid },
  ];
}

// Build a CodeMirror theme from a theme's UI tokens + a mono syntax palette.
function editorTheme(
  ui: ThemeUI,
  mode: "light" | "dark",
  syntax: SyntaxColors
): Extension {
  return createTheme({
    theme: mode,
    settings: {
      background: ui.editorBg,
      foreground: ui.editorFg,
      caret: ui.editorFg,
      selection: ui.selection,
      selectionMatch: ui.selection,
      lineHighlight: ui.currentLine,
      gutterBackground: ui.editorBg,
      gutterForeground: ui.muted,
      fontFamily: MONO,
    },
    styles: monoStyles(syntax),
  });
}

// ---- Themes --------------------------------------------------------------

// Vercel Night — zinc scale + emerald accent, pure-black editor.
const vercelNightUI: ThemeUI = {
  editorBg: tw.black,
  editorFg: tw.white,
  currentLine: alpha(tw.green[500], 0.2),
  selection: alpha(tw.green[500], 0.33),
  headerBg: tw.zinc[800],
  fieldBg: tw.zinc[950],
  tabbarBg: tw.zinc[900],
  tabActiveBg: tw.zinc[800],
  statusBg: tw.zinc[900],
  popoverBg: tw.zinc[900],
  text: tw.zinc[100],
  secondary: tw.zinc[400],
  muted: tw.zinc[500],
  border: tw.zinc[800],
  accent: tw.emerald[500],
  onAccent: tw.emerald[950],
  danger: tw.red[400],
};

// Vercel Day — zinc scale + emerald accent, white editor.
const vercelDayUI: ThemeUI = {
  editorBg: tw.white,
  editorFg: tw.zinc[900],
  currentLine: alpha(tw.emerald[500], 0.1),
  selection: alpha(tw.emerald[500], 0.2),
  headerBg: tw.zinc[100],
  fieldBg: tw.white,
  tabbarBg: tw.zinc[50],
  tabActiveBg: tw.white,
  statusBg: tw.zinc[100],
  popoverBg: tw.white,
  text: tw.zinc[900],
  secondary: tw.zinc[600],
  muted: tw.zinc[400],
  border: tw.zinc[200],
  accent: tw.emerald[600],
  onAccent: tw.white,
  danger: tw.red[600],
};

// Vivid / neon content palette — the chrome stays monochrome, the writing pops.
const nightSyntax: SyntaxColors = {
  plain: tw.zinc[100], // near-white body
  heading: tw.violet[400],
  keyword: tw.pink[400],
  string: tw.green[400],
  number: tw.orange[400],
  func: tw.cyan[400],
  comment: tw.zinc[500],
  punct: tw.zinc[400],
  link: tw.sky[400],
  invalid: tw.red[400],
};

const daySyntax: SyntaxColors = {
  plain: tw.zinc[900],
  heading: tw.violet[600],
  keyword: tw.pink[600],
  string: tw.green[600],
  number: tw.orange[600],
  func: tw.cyan[600],
  comment: tw.zinc[400],
  punct: tw.zinc[500],
  link: tw.sky[600],
  invalid: tw.red[600],
};

// GitHub & Tokyo — "guest" themes: their own palettes (not Tailwind), kept for
// their editor syntax highlighting, expressed through the same named roles.
const githubLightUI: ThemeUI = {
  editorBg: "#ffffff",
  editorFg: "#24292f",
  currentLine: "rgba(9, 105, 218, 0.06)",
  selection: "rgba(9, 105, 218, 0.15)",
  headerBg: "#eaeef2",
  fieldBg: "#ffffff",
  tabbarBg: "#f6f8fa",
  tabActiveBg: "#ffffff",
  statusBg: "#eaeef2",
  popoverBg: "#ffffff",
  text: "#24292f",
  secondary: "#57606a",
  muted: "#8b949e",
  border: "#d0d7de",
  accent: "#0969da",
  onAccent: "#ffffff",
  danger: "#cf222e",
};

const githubDarkUI: ThemeUI = {
  editorBg: "#0d1117",
  editorFg: "#c9d1d9",
  currentLine: "rgba(56, 139, 253, 0.1)",
  selection: "rgba(56, 139, 253, 0.3)",
  headerBg: "#161b22",
  fieldBg: "#0d1117",
  tabbarBg: "#0d1117",
  tabActiveBg: "#21262d",
  statusBg: "#161b22",
  popoverBg: "#161b22",
  text: "#c9d1d9",
  secondary: "#8b949e",
  muted: "#6e7681",
  border: "#30363d",
  accent: "#58a6ff",
  onAccent: "#0d1117",
  danger: "#f85149",
};

// GitHub content colors (their own palette) — documentation for the preview;
// the actual editor syntax comes from the @uiw github theme packages.
const githubLightSyntax: SyntaxColors = {
  plain: "#24292f",
  heading: "#0550ae",
  keyword: "#cf222e",
  string: "#0a3069",
  number: "#0550ae",
  func: "#8250df",
  comment: "#6e7781",
  punct: "#24292f",
  link: "#0969da",
  invalid: "#cf222e",
};

const githubDarkSyntax: SyntaxColors = {
  plain: "#c9d1d9",
  heading: "#79c0ff",
  keyword: "#ff7b72",
  string: "#a5d6ff",
  number: "#79c0ff",
  func: "#d2a8ff",
  comment: "#8b949e",
  punct: "#c9d1d9",
  link: "#58a6ff",
  invalid: "#f85149",
};

export const THEMES: ThemeDef[] = [
  {
    id: "vercel-night",
    label: "Vercel Night",
    mode: "dark",
    cm: editorTheme(vercelNightUI, "dark", nightSyntax),
    ui: vercelNightUI,
    syntax: nightSyntax,
  },
  {
    id: "vercel-day",
    label: "Vercel Day",
    mode: "light",
    cm: editorTheme(vercelDayUI, "light", daySyntax),
    ui: vercelDayUI,
    syntax: daySyntax,
  },
  {
    id: "light",
    label: "GitHub Light",
    mode: "light",
    cm: githubLight,
    ui: githubLightUI,
    syntax: githubLightSyntax,
  },
  {
    id: "dark",
    label: "GitHub Dark",
    mode: "dark",
    cm: githubDark,
    ui: githubDarkUI,
    syntax: githubDarkSyntax,
  },
];

export const DEFAULT_THEME_ID = "vercel-night";

export function themeById(id?: string | null): ThemeDef {
  return THEMES.find((th) => th.id === id) ?? THEMES[0];
}

export function nextThemeId(id: string): string {
  const i = THEMES.findIndex((th) => th.id === id);
  return THEMES[(i + 1) % THEMES.length].id;
}
