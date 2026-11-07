# Mobile bottom tab bar (`mob__tabs`)

> Fixed bottom navigation on mobile. 5 tabs, the last one being "Plus" (overflow menu) — matching production exactly.

---

## Anatomy

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│                                                      │
│  (page content scrolls above)                        │
│                                                      │
├──────────────────────────────────────────────────────┤  border-top
│ ▢▢▢▢   🏠   ⚡   ▦   ☰                                │
│ Dash    Maison  Énergie  Modes  Plus                 │  76 px (incl. 18 px safe-area)
└──────────────────────────────────────────────────────┘
```

Order matters: **Dashboard / Maison / Énergie / Modes / Plus** — confirmed by production via Playwright inspection. Énergie is the SECOND most accessed scope after Maison, so it sits right next to Maison.

---

## States

| State   | Class               | Effect                    |
| ------- | ------------------- | ------------------------- |
| Default | `.mob__tab`         | icon + label in `--n-400` |
| Active  | `.mob__tab--active` | icon + label in `--p-500` |

Only one tab is `--active` at a time. The active tab matches the current route.

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
  left: 0;
  right: 0;
  bottom: 0;
  height: 76px;
  padding-bottom: 18px; /* iOS safe-area */
  background: var(--n-0);
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  backdrop-filter: blur(8px);
}

.mob__tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--n-400);
  cursor: pointer;
}
.mob__tab svg {
  width: 20px;
  height: 20px;
}
.mob__tab-label {
  font-size: var(--fs-micro);
  font-weight: 600;
  letter-spacing: 0.02em;
}

.mob__tab--active {
  color: var(--p-500);
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

| Concern        | Implementation                                                                       |
| -------------- | ------------------------------------------------------------------------------------ |
| Landmark       | `<nav role="navigation" aria-label="Navigation principale">` in production.          |
| Tab role       | Each tab is a `<Link>` or `<button>` — focusable and keyboard-activatable.           |
| Active state   | Use `aria-current="page"` on the active tab in addition to the `--active` class.     |
| Touch target   | 76 × ~(viewport/5) px — each tab is ~78 × 76 on a 390 px viewport. **Passes 44×44**. |
| Color contrast | `--n-400` on `--n-0`: 5.6:1 — AA (large text). Active `--p-500`: 9.8:1 — AAA.        |
| iOS safe-area  | The 18 px bottom padding accounts for the home indicator on modern iPhones.          |

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
