# Mobile bottom tab bar (`mob__tabs`)

> Bottom navigation below `lg`: a pill floating over the page, the iOS 26 shape (#1264, amends spec 208 FR7). 5 tabs, the last one being "Plus" (overflow menu).

---

## Anatomy

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│                                                      │
│  (page content scrolls under the pill)               │
│   ╭──────────────────────────────────────────────╮   │  16 px from the sides
│   │ ▢▢▢▢ (🏠    )  ⚡     ▦      ☰               │   │  62 px, rounded-full, glass
│   │ Dash (Maison)  Énergie Modes  Plus           │   │  (…) = the active tab's grey pill
│   ╰──────────────────────────────────────────────╯   │
│                                                      │  20 px over the home indicator,
└──────────────────────────────────────────────────────┘  12 px with no safe area
```

Order matters: **Dashboard / Maison / Énergie / Modes / Plus** — confirmed by production via Playwright inspection. Énergie is the SECOND most accessed scope after Maison, so it sits right next to Maison.

---

## States

| State   | Class               | Effect                                                                                                                           |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Default | `.mob__tab`         | icon (22 px, stroke 1.5) + label in `text-secondary`, medium                                                                     |
| Active  | `.mob__tab--active` | the whole tab (icon + label) on a grey pill, the text colour at 8 % (`bg-text/8`), stroke 2; icon + label in `--p-500`, semibold |

Only one tab is `--active` at a time. The active tab matches the current route. Spec 208 added a pill because the colour change alone did not show the selection on a phone; #1264 made it the grey pill of the iOS 26 tab bar.

The bar (`MobileNav` in `ui/src/components/layout/AppLayout.tsx`) is `absolute` over the content column, `inset-x-4`, `bottom-(--tabbar-offset)`, `h-(--tabbar-height)` (62 px), `p-1`, `rounded-full`, a hairline border, the glass `--tabbar-glass` (the surface at 75 %, 85 % in dark) with `backdrop-blur-xl backdrop-saturate-150`, and `shadow-lg` as a floating layer. It is `z-30`, like the top bar, so page menus (z-40) and drawers draw over it. The variables live in `ui/src/index.css`: `--tabbar-offset` is `max(12px, safe-area − 14px)`, and `--tabbar-clearance` (pill + offset + 12 px) is the padding under `<main>` and the lift of the install banner and the restart toast on phones. The heavier stroke of the active icon is the one exception to the 1.5 px Lucide stroke.

---

## Code

```html
<div class="mob__tabs">
  <div class="mob__tab">
    <svg>… Grid3x3 …</svg>
    <span class="mob__tab-label">Dashboard</span>
  </div>
  <div class="mob__tab mob__tab--active">
    <svg>… Home …</svg>
    <span class="mob__tab-label">Maison</span>
  </div>
  <div class="mob__tab">
    <svg>… Zap …</svg>
    <span class="mob__tab-label">Énergie</span>
  </div>
  <div class="mob__tab">
    <svg>… Layers …</svg>
    <span class="mob__tab-label">Modes</span>
  </div>
  <div class="mob__tab">
    <svg>… horizontal lines (Menu / hamburger) …</svg>
    <span class="mob__tab-label">Plus</span>
  </div>
</div>
```

```css
.mob__tabs {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: var(--tabbar-offset); /* max(12px, safe area - 14px) */
  height: 62px;
  padding: 4px;
  display: flex;
  border-radius: 9999px;
  border: 1px solid var(--line);
  background: var(--tabbar-glass); /* surface at 75 %, 85 % in dark */
  backdrop-filter: blur(24px) saturate(150%);
  box-shadow: var(--sh-3);
}

.mob__tab {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 9999px;
  color: var(--n-600); /* text-secondary */
  cursor: pointer;
}
.mob__tab svg {
  width: 22px;
  height: 22px;
}
.mob__tab-label {
  font-size: var(--fs-micro);
  font-weight: 500;
}

.mob__tab--active {
  background: color-mix(in oklab, var(--n-700) 8%, transparent); /* bg-text/8 */
  color: var(--p-500);
  font-weight: 600;
}
.mob__tab--active svg {
  stroke-width: 2;
}
```

---

## "Plus" tab behavior

The Plus tab is an **overflow menu trigger**, not a route. Tapping it opens a drawer or sheet with secondary navigation (Analyse, Réglages, Administration, etc.).

In production this is implemented in `AppLayout.tsx`'s `MobileNavLink` component with a sheet overlay.

---

## Why this exact order

The user explicitly asked for this order ("Énergie right of Maison") and Playwright verified the production order is:

1. **Dashboard** — landing
2. **Maison** — zone tree
3. **Énergie** — energy dashboard
4. **Modes** — automation states
5. **Plus** — everything else

This ordering reflects **usage frequency** on mobile (Dashboard glance > Zone control > Energy peek > Mode switch > Settings rarely).

---

## Accessibility

| Concern        | Implementation                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Landmark       | `<nav aria-label="Navigation principale">` (`nav.main`, "Main navigation" in English).                                 |
| Tab role       | Each tab is a `<Link>` or `<button>` — focusable and keyboard-activatable.                                             |
| Active state   | Use `aria-current="page"` on the active tab in addition to the `--active` class.                                       |
| Touch target   | 52 px high, an equal share of the pill: ~70 × 52 at 390 px, ~56 × 52 at 320 px. **Passes 44×44**.                      |
| Color contrast | `--n-600` on `--n-0`: 10.25:1. Active `--p-500` on its grey pill: 7.6:1 (light), 4.75:1 (dark), `color-roles.test.ts`. |
| iOS safe-area  | The pill floats 20 px above the edge over a 34 pt inset (12 px with none), clear of the home indicator swipe.          |

---

## Do / Don't

✅ **Do**: respect the production order (Dashboard / Maison / Énergie / Modes / Plus).
✅ **Do**: keep the Plus tab as a menu trigger, not a route.
✅ **Do**: use the hamburger icon (3 lines) for Plus — matches production.

❌ **Don't**: rearrange tabs by alphabet or developer preference. Production order is calibrated by usage.
❌ **Don't**: replace Plus with a specific item (e.g. "Réglages"). The overflow menu is essential for accessing the long tail of features without bloating the tab bar.
❌ **Don't**: add a 6th tab. 5 is the max for thumb-friendly touch.

---

## React mapping (proposal)

```tsx
<MobileTabBar>
  <MobileTabLink to="/dashboard" icon={<Grid3x3 />} label="Dashboard" />
  <MobileTabLink to="/home" icon={<Home />} label="Maison" />
  <MobileTabLink to="/energy" icon={<Zap />} label="Énergie" />
  <MobileTabLink to="/modes" icon={<Layers />} label="Modes" />
  <MobileTabButton onClick={openOverflow} icon={<Menu />} label="Plus" />
</MobileTabBar>
```

---

## See also

- [sidebar-nav.md](sidebar-nav.md) — Desktop equivalent
- [topbar.md](topbar.md) — Replaced on mobile by the `mob__topbar` with hamburger menu in the title bar
