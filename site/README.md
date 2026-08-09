# Parker — landing page

The marketing site for Parker, at **[getparker.dev](https://getparker.dev)**.

Pure static HTML/CSS/JS — no build step, no dependencies. Matches Parker's own
ethos (fast, lightweight) and its `Vercel Night` / `Vercel Day` theme palette
(see `../src/lib/themes.ts`).

## Files

| File | What it is |
|------|-----------|
| `index.html` | The whole page (nav, hero + app mockup, features, philosophy, CTA, footer). |
| `styles.css` | Theme tokens (light/dark) + all styling. |
| `script.js`  | Theme toggle (persisted), scroll-reveal, sticky-nav hairline. |
| `brand/parker-app.webp` / `.png` | **Real screenshot** of the Parker app in the hero (editor + live Markdown preview + git backup), Vercel Night. Native window capture — rounded corners + shadow baked into the transparent margins. WebP served with PNG fallback via `<picture>`. |
| `brand/parker-head.svg` | The head mark (currentColor), driven via CSS mask so it flips ink↔paper with the theme. |
| `favicon-16/32.png`, `favicon.png` | `pk` monogram favicons (per the brand guide, legible at tiny sizes). |
| `apple-touch-icon.png` | 180px app icon (head on dark tile). |
| `og.png` | 1200×630 social card, built from the brand illustration. |

## Brand

Assets come from the Parker Brand Guide. Applied here: the **head mark** (nav +
footer, theme-adaptive), the lowercase **`parker`** wordmark in Geist Mono 500
(tracking −0.045em), and lowercase `parker` in body copy per the brand voice.
The emerald accent is kept intentionally (it matches the app's Vercel Night
theme) — the formal guide is monochrome, so drop the accent here if you ever
want strict brand-guide fidelity.

Only `brand/parker-head.svg` is loaded at runtime; the site stays ~0.5 MB total.
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

## TODO before launch

- [ ] Make the GitHub repo public (links point to `github.com/mlemos/parker`).
- [ ] Real download link (`/releases`) once the first `.dmg` ships.
- [x] Social card `og.png` (1200×630).
- [x] Real brand mark, wordmark and favicons wired in.
