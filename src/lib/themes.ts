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

// ---- To-do states ---------------------------------------------------------
/**
 * The colour each live to-do state wears, named by the state and not by the
 * hue — because "green" is only what DONE happens to look like on the house
 * themes. On the playa it is creosote; on a phosphor tube it is the tube.
 *
 * The palette is derived from the state machine, never picked by eye (the rule
 * that produced it; see App.css). DONE and FAIL are two of the three poles;
 * DOING is the pole DONE has not arrived at yet and ATTN is FAIL's; PAUSE and
 * WAIT are two kinds of stall — one you caused, one somebody else did. TODO is
 * the origin and wears no colour at all, and CANCEL is the third pole, which
 * every theme already names: it takes `ui.muted`.
 *
 * A theme must keep those relationships legible on its own ground. What it
 * must not do is keep the hexes: at 8px inside a checkbox, a colour that does
 * not separate from the text around it is a state nobody can read — which is
 * exactly what the house green did on Matrix, where the body text is green too.
 */
export interface TodoColors {
  doing: string;
  pause: string;
  wait: string; // also the "somebody else changed this" conflict marker
  attn: string;
  done: string;
  fail: string;
}

export interface ThemeDef {
  id: string;
  label: string;
  mode: "light" | "dark";
  cm: Extension;
  ui: ThemeUI; // chrome roles
  syntax: SyntaxColors; // editor content roles
  todo: TodoColors; // to-do state roles
}

const MONO =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

// ---- Editor content colors (syntax) --------------------------------------
// Named roles for what you write. Parker's own themes are monochrome
// (brightness/weight, not hue) built on Tailwind's zinc scale.
export interface SyntaxColors {
  plain: string; // body text / identifiers
  heading: string; // markdown headings
  bold: string; // **bold** (bold-italic uses this color too)
  italic: string; // *italic*
  list: string; // list markers (*, -, 1.)
  inlineCode: string; // `inline code` / plain code fences
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
    // emphasis before strong so a bold-italic node (both classes) resolves to
    // strong's color — bold-italic = bold color + italic.
    { tag: [t.emphasis], color: p.italic, fontStyle: "italic" },
    { tag: [t.strong], color: p.bold, fontWeight: "700" },
    { tag: [t.link, t.url], color: p.link, textDecoration: "underline" },
    { tag: [t.quote], color: p.string },
    { tag: [t.monospace], color: p.inlineCode },
    // NOTE: intentionally NO rule for processingInstruction/meta so markdown
    // marks (#, [], (), **) inherit the color of what they mark (heading, link,
    // strong) instead of a flat grey.
    { tag: [t.list], color: p.list },
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

// The house to-do ramp, on the Tailwind scale the house themes are built from.
// Two rungs of it: the 400s carry on a dark ground, and wash out on a light
// one — the same reason `daySyntax` steps down to the 600s.
const darkTodo: TodoColors = {
  doing: tw.cyan[400],
  pause: tw.blue[400],
  wait: tw.purple[400],
  attn: tw.amber[400],
  done: tw.green[400],
  // red-500, not 400: the Tailwind ramp lightens by dropping saturation, and
  // in the reds that lands on salmon.
  fail: tw.red[500],
};
const lightTodo: TodoColors = {
  doing: tw.cyan[600],
  pause: tw.blue[600],
  wait: tw.purple[600],
  attn: tw.amber[600],
  done: tw.green[600],
  fail: tw.red[600],
};

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
  bold: tw.amber[400],
  italic: tw.emerald[300],
  list: tw.cyan[400],
  inlineCode: tw.fuchsia[400],
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
  bold: tw.amber[600],
  italic: tw.emerald[600],
  list: tw.cyan[600],
  inlineCode: tw.fuchsia[600],
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
  bold: "#24292f",
  italic: "#24292f",
  list: "#6e7781",
  inlineCode: "#0a3069",
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
  bold: "#c9d1d9",
  italic: "#c9d1d9",
  list: "#8b949e",
  inlineCode: "#a5d6ff",
  keyword: "#ff7b72",
  string: "#a5d6ff",
  number: "#79c0ff",
  func: "#d2a8ff",
  comment: "#8b949e",
  punct: "#c9d1d9",
  link: "#58a6ff",
  invalid: "#f85149",
};

// ---- Guest themes, ported from mdiagrams ---------------------------------
// Four palettes drawn for the diagram library next door
// (mdiagrams/packages/core/src/theme.ts) and brought over whole: same grounds,
// same accents, same intent. What the diagrams call `background`/`surface`/
// `text`/`muted`/`accent` becomes Parker's editor, chrome, and three text
// tiers; the syntax palette is new here, because a diagram has no code in it.
//
// They are not built on the Tailwind scales above — that is the point of a
// guest theme. Each one is a place with its own light, and mixing zinc into it
// would only make it look like the others.

// Playa — noon, white dust, hard sun, nothing in shade. The only light theme
// here that isn't paper: the ground has a colour of its own.
const playaUI: ThemeUI = {
  editorBg: "#e8e0d0",
  editorFg: "#3d2f1e",
  currentLine: alpha("#bf641e", 0.1),
  selection: alpha("#bf641e", 0.22),
  headerBg: "#ded4c0",
  fieldBg: "#f2ece0",
  tabbarBg: "#e2d9c8",
  tabActiveBg: "#f2ece0",
  statusBg: "#ded4c0",
  popoverBg: "#f2ece0",
  text: "#3d2f1e",
  secondary: "#5f4d38",
  muted: "#8a7860",
  border: "rgba(84, 66, 44, 0.28)",
  accent: "#bf641e",
  onAccent: "#f7f2e8",
  danger: "#b3301c",
};

// Sun-bleached: the hues are all things the place actually is — rust, sage,
// creosote, the one teal that is always somebody's shade structure.
const playaSyntax: SyntaxColors = {
  plain: "#3d2f1e",
  heading: "#bf641e",
  bold: "#8f4a12",
  italic: "#4f7373",
  list: "#845947",
  inlineCode: "#7a5c2e",
  keyword: "#a8471c",
  string: "#5b6b3a",
  number: "#8d6b1f",
  func: "#4f7373",
  comment: "#8a7860",
  punct: "#6b5a44",
  link: "#2f6f6f",
  invalid: "#b3301c",
};

// Playa at Night — the same place after dark, when everything visible is lit
// from within. Deep ground, and a palette of things that glow rather than
// reflect: el wire, neon, the flame effect two blocks over.
const playaNightUI: ThemeUI = {
  editorBg: "#0b0a14",
  editorFg: "#ddd6ff",
  currentLine: alpha("#968cdc", 0.12),
  selection: alpha("#ff785a", 0.24),
  headerBg: "#121022",
  fieldBg: "#0b0a14",
  tabbarBg: "#0e0c1a",
  tabActiveBg: "#1b1830",
  statusBg: "#121022",
  popoverBg: "#121022",
  text: "#ddd6ff",
  secondary: "#a49bd0",
  muted: "#8b83b5",
  border: "rgba(150, 140, 220, 0.24)",
  accent: "#ff785a",
  onAccent: "#0b0a14",
  danger: "#ff5a7a",
};

const playaNightSyntax: SyntaxColors = {
  plain: "#ddd6ff",
  heading: "#ff785a",
  bold: "#ffb26b",
  italic: "#5adcc8",
  list: "#b9a8ff",
  inlineCode: "#ff9ecb",
  keyword: "#bd93ff",
  string: "#5adcc8",
  number: "#ffb26b",
  func: "#7fd1ff",
  comment: "#8b83b5",
  punct: "#9a92c4",
  link: "#7fd1ff",
  invalid: "#ff5a7a",
};

// Matrix — phosphor green on black, the falling-code look. One hue and a
// brightness ladder, which is what a P1 tube actually gave you.
const matrixUI: ThemeUI = {
  editorBg: "#000500",
  editorFg: "#7dffa4",
  currentLine: alpha("#00ff66", 0.1),
  selection: alpha("#00ff66", 0.25),
  headerBg: "#00190a",
  fieldBg: "#000500",
  tabbarBg: "#001206",
  tabActiveBg: "#00250f",
  statusBg: "#00190a",
  popoverBg: "#00190a",
  text: "#7dffa4",
  secondary: "#4ec97a",
  muted: "#2f8f4f",
  border: "rgba(0, 255, 102, 0.28)",
  accent: "#00ff66",
  onAccent: "#000500",
  // The one thing here that isn't green, and deliberately: a destructive
  // action that blends into the phosphor is a destructive action nobody sees.
  danger: "#ff4f4f",
};

const matrixSyntax: SyntaxColors = {
  plain: "#7dffa4",
  heading: "#00ff66",
  bold: "#b6ffcc",
  italic: "#5fd68a",
  list: "#2fbe5f",
  inlineCode: "#9dffc0",
  keyword: "#00ff66",
  string: "#42ad46",
  number: "#c8ff7d",
  func: "#70c29a",
  comment: "#2f8f4f",
  punct: "#4a9c68",
  link: "#00ffcc",
  invalid: "#ff4f4f",
};

// Blueprint — cyanotype: pale technical linework on deep drawing-office blue.
// White is the ink here, not the paper, so headings and type names are the
// brightest thing on the sheet.
const blueprintUI: ThemeUI = {
  editorBg: "#0c2a55",
  editorFg: "#dbe9ff",
  currentLine: alpha("#cbe3ff", 0.08),
  selection: alpha("#a6d8ff", 0.24),
  headerBg: "#0f3466",
  fieldBg: "#0c2a55",
  tabbarBg: "#0a2549",
  tabActiveBg: "#143d78",
  statusBg: "#0f3466",
  popoverBg: "#0f3466",
  text: "#dbe9ff",
  secondary: "#b3cdf0",
  muted: "#84a4cd",
  border: "rgba(210, 232, 255, 0.30)",
  accent: "#a6d8ff",
  onAccent: "#0c2a55",
  // A red would be a second ink the process never had; the correction on a
  // cyanotype is a warm chalk, and it reads on this ground.
  danger: "#ff9d8a",
};

const blueprintSyntax: SyntaxColors = {
  plain: "#dbe9ff",
  heading: "#ffffff",
  bold: "#ffffff",
  italic: "#a6d8ff",
  list: "#94cdff",
  inlineCode: "#cbe3ff",
  keyword: "#a6d8ff",
  string: "#a1bdc6",
  number: "#b8c6e8",
  func: "#ffffff",
  comment: "#84a4cd",
  punct: "#9fb8dd",
  link: "#a6d8ff",
  invalid: "#ff9d8a",
};


// The guests keep their own worlds here too. Each one holds the state
// machine's relationships — arrival, its approach, two kinds of stall, the two
// failures — in colours that belong to the place.

// Noon: creosote for done, the sun for attention, the rust for failure, and
// the teal of somebody's shade structure for work in motion. All dark enough
// to hold on a dusty ground.
const playaTodo: TodoColors = {
  doing: "#2f6f6f",
  pause: "#334f9e",
  wait: "#7a4f8a",
  attn: "#bf641e",
  done: "#5b7a34",
  fail: "#b3301c",
};

// After dark, every state is something lit from within.
const playaNightTodo: TodoColors = {
  doing: "#41c9ea",
  pause: "#6aa9ff",
  wait: "#bd93ff",
  attn: "#ffb26b",
  done: "#6ee7a8",
  fail: "#ff5a7a",
};

// One tube, mostly. DONE is the phosphor at full brightness and PAUSE is the
// same tube dimmed; DOING drifts toward cyan because it has not arrived yet,
// and WAIT greys out because the tube is somebody else's. The two that break
// the hue are the two that must: ATTN borrows the amber phosphor — the other
// tube these terminals came in — and FAIL is the theme's red, for the same
// reason its danger colour is.
const matrixTodo: TodoColors = {
  doing: "#00d9a0",
  pause: "#3fbf72",
  wait: "#8fb3a5",
  attn: "#ffb000",
  done: "#00ff66",
  fail: "#ff4f4f",
};

// A drawing office annotates in pale washes, chalk and red pencil, and this
// palette is those: nothing saturated, everything readable over deep blue.
const blueprintTodo: TodoColors = {
  doing: "#a6d8ff",
  pause: "#4fb3e8",
  wait: "#c9a8f0",
  attn: "#ffd28a",
  done: "#8fd6a8",
  fail: "#ff9d8a",
};

export const THEMES: ThemeDef[] = [
  {
    id: "vercel-night",
    label: "Vercel Night",
    mode: "dark",
    cm: editorTheme(vercelNightUI, "dark", nightSyntax),
    ui: vercelNightUI,
    syntax: nightSyntax,
    todo: darkTodo,
  },
  {
    id: "vercel-day",
    label: "Vercel Day",
    mode: "light",
    cm: editorTheme(vercelDayUI, "light", daySyntax),
    ui: vercelDayUI,
    syntax: daySyntax,
    todo: lightTodo,
  },
  {
    id: "light",
    label: "GitHub Light",
    mode: "light",
    cm: githubLight,
    ui: githubLightUI,
    syntax: githubLightSyntax,
    todo: lightTodo,
  },
  {
    id: "dark",
    label: "GitHub Dark",
    mode: "dark",
    cm: githubDark,
    ui: githubDarkUI,
    syntax: githubDarkSyntax,
    todo: darkTodo,
  },
  {
    id: "playa",
    label: "Playa",
    mode: "light",
    cm: editorTheme(playaUI, "light", playaSyntax),
    ui: playaUI,
    syntax: playaSyntax,
    todo: playaTodo,
  },
  {
    id: "playa-night",
    label: "Playa at Night",
    mode: "dark",
    cm: editorTheme(playaNightUI, "dark", playaNightSyntax),
    ui: playaNightUI,
    syntax: playaNightSyntax,
    todo: playaNightTodo,
  },
  {
    id: "matrix",
    label: "Matrix",
    mode: "dark",
    cm: editorTheme(matrixUI, "dark", matrixSyntax),
    ui: matrixUI,
    syntax: matrixSyntax,
    todo: matrixTodo,
  },
  {
    id: "blueprint",
    label: "Blueprint",
    mode: "dark",
    cm: editorTheme(blueprintUI, "dark", blueprintSyntax),
    ui: blueprintUI,
    syntax: blueprintSyntax,
    todo: blueprintTodo,
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
