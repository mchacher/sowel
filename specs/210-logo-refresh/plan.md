# Implementation Plan — Spec 210

## Slices

### Slice A — The component and the splash

- [x] A.1 — Rewrite `SowelLogo.tsx`: shared constants, `Mark` with `small` and `animated`, `showText` variant with the lowercase wordmark; sidebar wordmark in `Sidebar.tsx`
- [x] A.2 — Update the splash in `ui/index.html` (drawing, wordmark, wink) and bump `apple-touch-icon` to `?v=4`

### Slice B — Static icons

- [x] B.1 — `ui/public/favicon.svg` and `docs/assets/favicon.svg` (small weight)
- [x] B.2 — `ui/public/pwa-icon.svg` and `pwa-maskable.svg` (master, scaled into the tile and, for the maskable one, into the 80 % safe circle: measure the farthest ink pixel on the PNG)
- [x] B.3 — Render the four PNGs from the SVG sources

### Slice C — Drift guard

- [x] C.1 — `ui/src/lib/logo-sync.test.ts`

### Slice D — Docs

- [x] D.1 — `docs/assets/logo.svg` (small weight: it is shown at 28 px)
- [x] D.2 — `docs/index.md` and `docs/index.fr.md` (hero mark, large mark, wordmark), `docs/stylesheets/extra.css`
- [x] D.3 — `design-system/tokens.md`

### PNG procedure (B.3)

Render with headless Chromium from the SVG sources, transparent corners kept for the rounded tile:

```bash
# from a scratch directory outside the repo, with Playwright available
node render-icons.mjs   # opens each SVG at the target size and writes the PNG over ui/public/<name>.png
```

Sizes: `apple-touch-icon-180x180.png` and `pwa-192x192.png` and `pwa-512x512.png` from `pwa-icon.svg`;
`pwa-maskable-512x512.png` from `pwa-maskable.svg`. Then look at each PNG at its size before committing.

## Test Plan

There is no business logic here and the project has no React component tests, so the guard is a source-level test.

### Modules to test

- `ui/src/lib/logo-sync.test.ts` against `SowelLogo.tsx` and the static assets

### Scenarios

| Module    | Scenario                                                                   | Expected                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| logo-sync | `ui/public/favicon.svg`, `docs/assets/favicon.svg`, `docs/assets/logo.svg` | Every path at the small stroke width, viewBox `20 10 160 165`                                                                                                           |
| logo-sync | `pwa-icon.svg`, `pwa-maskable.svg`                                         | Every path at the master stroke width of its weight                                                                                                                     |
| logo-sync | `ui/index.html` splash                                                     | Contains the house path, master left eye and smile                                                                                                                      |
| logo-sync | `SowelLogo.tsx`                                                            | Defines both weights (the test fails if it stops)                                                                                                                       |
| logo-sync | Docs landing, EN and FR                                                    | Each class (`house`, `smile`, `left-eye`, `right-eye`) draws its path in the two inline SVGs; CSS widths on the right selectors; the wordmark rule is unique and Nunito |
| logo-sync | `SowelLogo.tsx` and `Sidebar.tsx`                                          | Threshold `size < SMALL_BELOW_PX`, both viewBoxes, lowercase « sowel », no « SOWEL » left                                                                               |
| logo-sync | One path, one stroke width or the wordmark of a copy altered on purpose    | The test fails, then the copy is restored                                                                                                                               |

## Validation Plan

- `npm run validate`
- `bash scripts/check-specs-complete.sh`, `check-specs-index.sh folders`, `check-docs-parity.sh`, `check-docs-impact.sh`
- `mkdocs build --strict` (in a scratch virtualenv)
- Manual: screenshots of the login/setup page, the sidebar and the mobile header; the splash; the favicon in a tab;
  each PNG at its real size; the docs landing in EN and FR
