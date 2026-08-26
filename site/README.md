# Parker — landing page

The marketing site for Parker, at **[getparker.dev](https://getparker.dev)**.

Pure static HTML/CSS/JS — no build step, no dependencies. Matches Parker's own
ethos (fast, lightweight) and its `Vercel Night` / `Vercel Day` theme palette
(see `../src/lib/themes.ts`).

## Files

| File | What it is |
|------|-----------|
| `index.html` | The home page (nav, hero + app screenshot, AI block, feature grid, philosophy, CTA, footer). |
| `features/index.html` | The deep dive at `/features` — seven feature sections with screenshots, an interactive to-do demo, the theme swatches, the shortcut reference and the spec strip. |
| `styles.css` | Theme tokens (light/dark) + all styling. |
| `script.js`  | Theme toggle (persisted), scroll-reveal, sticky-nav hairline. |
| `brand/parker-<version>-<theme>.webp` / `.png` | The hero screenshot, one per theme (`vercel-night`, `vercel-day`), swapped by `<picture>` with the site's own theme. Real window captures — three panes with the git commit menu open. WebP served with PNG fallback. Rename these on a release so the file never claims a version it isn't. |
| `brand/shots/parker-*.webp` | The screenshots on `/features`, all Vercel Night, all 1400px wide. Named `parker-<what-it-shows>` — the subject, not the version, since a feature shot outlives the release it was taken in. |
| `brand/parker-head.svg` | The head mark (currentColor), driven via CSS mask so it flips ink↔paper with the theme. |
| `favicon-16/32.png`, `favicon.png` | `pk` monogram favicons (per the brand guide, legible at tiny sizes). |
| `apple-touch-icon.png` | 180px app icon (head on dark tile). |
| `og.png` | 1200×630 social card, built from the brand illustration. |

## Brand

Assets come from the Parker Brand Guide. Applied here: the **head mark** (nav +
footer, theme-adaptive), the lowercase **`parker`** wordmark in Geist Mono 500
(tracking −0.045em). The wordmark stays lowercase because it is a logotype —
body copy says **Parker** with a capital P.
The emerald accent is kept intentionally (it matches the app's Vercel Night
theme) — the formal guide is monochrome, so drop the accent here if you ever
want strict brand-guide fidelity.

Only `brand/parker-head.svg` is loaded at runtime. The screenshots are the
weight: ~510 KB across the seven on `/features` and ~135 KB for the hero WebP —
but every image below the fold is `loading="lazy"`, so a visit costs one.

To regenerate `og.png`: grab `parker-mark-paper.png` from the brand-guide bundle,
build a temporary `og.html`, serve the folder, and screenshot it at 1200×630 with
headless Chrome.

## Local preview

```bash
cd site
python3 -m http.server 4321   # → http://localhost:4321
```

Force a theme for screenshots: `?theme=light` or `?theme=dark`.

## Deploy to Vercel

The domain `getparker.dev` is already registered in the Vercel account.

- **Root Directory:** `site`
- **Framework Preset:** Other (static)
- **Build Command:** none · **Output Directory:** `.`

```bash
cd site
vercel --prod        # or import the repo in the Vercel dashboard, root = site/
```

Then attach `getparker.dev` under the project's Domains tab.

## Capturing screenshots

Window shots are taken with the macOS grab: **⇧⌘4, Space, then ⌥-click** the
window — the Option is what leaves the shadow out, because the site adds its own
via CSS `filter: drop-shadow`, which adapts to the theme. For a shot that has to
show the window *over* something (the menu-bar section), drag a region instead
and keep the shadow: there it is the point.

Then crop and convert:

```bash
cwebp -q 84 -resize 1400 0 shot.png -o site/brand/shots/parker-name.webp
```

Two things to watch, both learned the hard way: the macOS filename has a
narrow no-break space (U+202F) before AM/PM, so match it with a glob rather than
a literal; and check what is *behind* the window before you shoot — a terminal
listing real note names does not belong on a public page.

## Icons

Every icon is [Lucide](https://lucide.dev), the same set the app uses — including
the to-do glyphs in the interactive demo, which are copied verbatim from
`../src/lib/todo-glyph.ts`. The exceptions are the brand marks (Apple, GitHub, X,
LinkedIn), which Lucide does not carry. Keyboard modifiers are Lucide too
(`command`, `option`, `arrow-big-up`, `chevron-up`); letters stay as text.

## TODO before launch

- [x] Make the GitHub repo public (links point to `github.com/mlemos/parker`).
- [ ] Real download link (`/releases`) once the first `.dmg` ships.
- [x] Social card `og.png` (1200×630).
- [x] Real brand mark, wordmark and favicons wired in.
