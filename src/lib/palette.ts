// Base palette — Tailwind CSS color scales. Themes are built by mapping app
// areas (see ThemeUI in themes.ts) onto these named colors, so every value in
// a theme traces back to a Tailwind swatch like `zinc[900]` or `emerald[500]`.

export const tw = {
  white: "#ffffff",
  black: "#000000",

  zinc: {
    50: "#fafafa", 100: "#f4f4f5", 200: "#e4e4e7", 300: "#d4d4d8",
    400: "#a1a1aa", 500: "#71717a", 600: "#52525b", 700: "#3f3f46",
    800: "#27272a", 900: "#18181b", 950: "#09090b",
  },
  neutral: {
    50: "#fafafa", 100: "#f5f5f5", 200: "#e5e5e5", 300: "#d4d4d4",
    400: "#a3a3a3", 500: "#737373", 600: "#525252", 700: "#404040",
    800: "#262626", 900: "#171717", 950: "#0a0a0a",
  },
  slate: {
    50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1",
    400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155",
    800: "#1e293b", 900: "#0f172a", 950: "#020617",
  },
  emerald: {
    50: "#ecfdf5", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981",
    600: "#059669", 700: "#047857", 800: "#065f46", 950: "#022c22",
  },
  green: {
    50: "#f0fdf4", 300: "#86efac", 400: "#4ade80", 500: "#22c55e",
    600: "#16a34a", 700: "#15803d", 950: "#052e16",
  },
  blue: {
    300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb",
    700: "#1d4ed8",
  },
  sky: {
    300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7",
  },
  red: {
    300: "#fca5a5", 400: "#f87171", 500: "#ef4444", 600: "#dc2626",
  },
  amber: {
    300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706",
  },
  orange: {
    300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c",
  },
  cyan: {
    300: "#67e8f9", 400: "#22d3ee", 500: "#06b6d4", 600: "#0891b2",
  },
  pink: {
    300: "#f9a8d4", 400: "#f472b6", 500: "#ec4899", 600: "#db2777",
  },
  fuchsia: {
    300: "#f0abfc", 400: "#e879f9", 500: "#d946ef", 600: "#c026d3",
  },
  purple: {
    300: "#d8b4fe", 400: "#c084fc", 500: "#a855f7", 600: "#9333ea",
  },
  violet: {
    300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed",
  },
  lime: {
    300: "#bef264", 400: "#a3e635", 500: "#84cc16", 600: "#65a30d",
  },
} as const;

/** hex (#rrggbb) → rgba() with the given alpha (0–1). */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
