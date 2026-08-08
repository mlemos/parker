// Display-only path helpers. The absolute path is kept everywhere in logic;
// these are used solely for what the user sees.

/** Abbreviate a home-relative absolute path to the "~/…" form. */
export function prettyPath(abs: string, home: string): string {
  if (!abs) return abs;
  if (home && (abs === home || abs.startsWith(home + "/"))) {
    return "~" + abs.slice(home.length);
  }
  return abs;
}
