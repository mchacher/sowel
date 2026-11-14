# Architecture — Spec 210

## Flow diagram

```
SowelLogo.tsx  (source of truth: house path, face paths, weights, colours)
   ├── rendered by the app    (Sidebar 40 px + « sowel », AppLayout 24 px, Login/Setup 160 px + wordmark, Wizard 32 px)
   │
   │  copied by hand into static assets, kept in step by the drift test
   ├── ui/index.html            splash  (master + « sowel », right eye winks in 1.2 s)
   ├── ui/public/favicon.svg    small weight
   ├── ui/public/pwa-icon.svg   master on a white 512 tile (rx 80)
   ├── ui/public/pwa-maskable.svg   master, full bleed, scaled to stay inside the maskable safe circle
   │        └── rendered to PNG: pwa-192x192, pwa-512x512, pwa-maskable-512x512, apple-touch-icon-180x180
   ├── docs/assets/logo.svg     small weight (header logo, 28 px)
   ├── docs/assets/favicon.svg  small weight
   └── docs/index.md + .fr.md   inline <svg class="sowel-logo"> (hero, large), CSS in extra.css sets the weights
```

No backend, API, event or database change.

## Components

### Changed: `ui/src/components/layout/SowelLogo.tsx`

Today it holds two unrelated drawings (a mono one without text, a two-tone one with the « SOWEL » text) and a
`MID_BLUE` constant. After: one internal `Mark` component taking `small` and `animated`; `SowelLogo` picks
`small = size < 32` for the plain variant and always the master for the `showText` variant (it is 160 px). Same props,
same exports: callers do not change.

### New: `ui/src/lib/logo-sync.test.ts`

Reads `SowelLogo.tsx` and the static assets with `node:fs`, extracts the house path and the master and small face
paths from the component, and asserts each asset contains the paths of its weight. It is a drift guard for the
exact problem that produced two drawings: copies edited separately.

### PNG icons

No generator exists in the repository and none is added (it would need a rendering dependency for four files that
change once in a year). The PNGs are rendered from the SVG sources with headless Chromium (Playwright, already
used for the documentation screenshots) at 180, 192 and 512 px, the maskable one from `pwa-maskable.svg`. The
procedure is written in `plan.md` so the next change can repeat it.

## Files changed

| Domain | File                                              | Change                                                 |
| ------ | ------------------------------------------------- | ------------------------------------------------------ |
| UI     | `ui/src/components/layout/SowelLogo.tsx`          | One drawing, two weights, lowercase wordmark           |
| UI     | `ui/src/components/layout/Sidebar.tsx`            | Wordmark « sowel », no letter-spacing                  |
| UI     | `ui/index.html`                                   | Splash drawing and wordmark; `apple-touch-icon` `?v=4` |
| UI     | `ui/public/favicon.svg`                           | Small weight                                           |
| UI     | `ui/public/pwa-icon.svg`, `pwa-maskable.svg`      | Master drawing                                         |
| UI     | `ui/public/*.png` (4 icons)                       | Regenerated                                            |
| UI     | `ui/src/lib/logo-sync.test.ts`                    | New drift guard                                        |
| Docs   | `docs/index.md`, `docs/index.fr.md`               | Hero and large mark, wordmark                          |
| Docs   | `docs/stylesheets/extra.css`                      | `.sowel-logo` weights, wordmark font, Nunito import    |
| Docs   | `docs/assets/logo.svg`, `docs/assets/favicon.svg` | New drawing                                            |
| Design | `design-system/tokens.md`                         | Logo and wordmark lines                                |
| Specs  | `docs/specs-index.md`, `docs/specs-index.fr.md`   | Row for spec 210                                       |

## Open question

Nunito is loaded from Google Fonts in `ui/index.html` today (weights 700 and 800; this spec keeps 700 only) and would be on the docs landing
too. Self-hosting it is consistent with « no cloud » but is a separate change: not in this spec.
