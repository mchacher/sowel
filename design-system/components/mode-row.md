# Mode row (`mode-row`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> A row inside the Comportements panel's Modes sub-category. Displays one mode (Lumière jour, Lumière nuit, …) with its action count, last application time, and an Apply / Active state.

---

## Anatomy

```
┌─────────┬─────────────────────┬───────────┐
│ [icon]  │ Lumière soir        │ [Apply]   │
│ 32×32   │ 4 actions · 21:00   │           │
│   ●     │ (active dot on icon)│           │
└─────────┴─────────────────────┴───────────┘
        ↑                            ↑
        Grid: 32px 1fr auto, gap .85rem
        Padding: .55rem 1.1rem, min-height 52px
```

The icon has an **overlay dot** at top-right indicating active state (green pulse when applied globally, neutral when not). This is the mode-row signature — it lets the user spot the active mode at a glance without needing a separate badge column.

---

## Variants

There is **one** mode-row shape. The difference between "not applied" and "applied" lives in:

- The dot overlay color
- The action on the right (Apply button vs. ACTIF badge)
- The `mode-row--active` modifier (faint green bg + green left bar)

| Variant  | Class combo                   | Right slot                                       |
| -------- | ----------------------------- | ------------------------------------------------ |
| Inactive | `.mode-row`                   | `<button class="mode-row__apply">Apply</button>` |
| Active   | `.mode-row .mode-row--active` | `<span class="mode-row__badge">Actif</span>`     |

---

## States

| State      | Class               | Effect                                                                                                             |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Default    | `.mode-row`         | white bg, neutral dot                                                                                              |
| Hover      | `:hover`            | bg `var(--n-25)`                                                                                                   |
| **Active** | `.mode-row--active` | bg green tint 4%, left border 3 px green-500, name color green-700 weight 700, icon bg green-50, dot pulsing green |

---

## Slots

| Column | Slot              | Required | Content                                                          |
| ------ | ----------------- | -------- | ---------------------------------------------------------------- |
| 1      | `.mode-row__icon` | yes      | 32×32 with Layers SVG + status dot overlay                       |
| 2      | `.mode-row__main` | yes      | `.mode-row__name` + `.mode-row__meta`                            |
| 3      | Action            | yes      | `.mode-row__apply` (button) OR `.mode-row__badge` (span "Actif") |

The icon uses **Layers** (Lucide) — same icon as the sidebar Modes nav item, the Comportements panel sub-cat header, and the mobile tab bar. Single icon, four placements, perfect consistency.

---

## Code

### Inactive mode

```html
<div class="mode-row">
  <div class="mode-row__icon">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
    <span class="mode-row__icon-dot"></span>
  </div>
  <div class="mode-row__main">
    <div class="mode-row__name">Lumière jour</div>
    <div class="mode-row__meta">1 action</div>
  </div>
  <button class="mode-row__apply">Apply</button>
</div>
```

### Active mode

```html
<div class="mode-row mode-row--active">
  <div class="mode-row__icon">
    <svg>…Layers…</svg>
    <span class="mode-row__icon-dot mode-row__icon-dot--active"></span>
  </div>
  <div class="mode-row__main">
    <div class="mode-row__name">Lumière soir</div>
    <div class="mode-row__meta">4 actions · appliqué 21:00</div>
  </div>
  <span class="mode-row__badge">Actif</span>
</div>
```

### CSS (key rules)

```css
.mode-row {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  gap: 0.85rem;
  align-items: center;
  padding: 0.55rem 1.1rem;
  min-height: 52px;
  box-sizing: border-box;
  border-top: 1px solid var(--line);
  cursor: pointer;
  transition: background 120ms;
}
.mode-row:hover {
  background: var(--n-25);
}

.mode-row__icon {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  background: var(--n-50);
  color: var(--n-500);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.mode-row__icon-dot {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--n-200);
  border: 2px solid var(--n-0);
}
.mode-row__icon-dot--active {
  background: var(--green-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green-500) 22%, transparent);
}

.mode-row__name {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--n-800);
  line-height: 1.25;
}
.mode-row__meta {
  font-size: 0.7rem;
  color: var(--n-400);
  line-height: 1.25;
  margin-top: 1px;
}

.mode-row--active {
  background: color-mix(in srgb, var(--green-500) 4%, var(--n-0));
  border-left: 3px solid var(--green-500);
  padding-left: calc(1.1rem - 3px);
}
.mode-row--active .mode-row__icon {
  background: var(--green-50);
  color: var(--green-700);
}
.mode-row--active .mode-row__name {
  color: var(--green-700);
  font-weight: 700;
}

.mode-row__apply {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-500);
  background: transparent;
  border: 1px solid var(--line);
  padding: 0.25rem 0.65rem;
  border-radius: var(--r-xs);
  cursor: pointer;
}
.mode-row__apply:hover {
  background: var(--p-50);
  border-color: var(--p-500);
}

.mode-row__badge {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--green-700);
  background: color-mix(in srgb, var(--green-500) 12%, transparent);
  padding: 2px 8px;
  border-radius: var(--r-full);
}
```

---

## Why line-height matters here

The mode-row stacks two lines of text in column 2 (name + meta). With default browser line-height (~1.5), this stack becomes ~40 px tall and the row inflates to 60 px, breaking alignment with eq-rows (52 px). The CSS sets `line-height: 1.25` on both name and meta to keep the stack at ~32 px, matching the 32 px icon and the row's 52 px min-height.

This is a **load-bearing CSS detail**. Don't change it without re-verifying alignment via the measurement table in [accessibility.md § Visual rhythm](../accessibility.md).

---

## Accessibility

| Concern            | Implementation                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row interaction    | The row is `cursor: pointer` (clickable to expand effects in production). In production should be a `<button>` or have `role="button"` + keyboard handler.     |
| Apply button label | `aria-label="Appliquer le mode Lumière jour"` (avoid bare "Apply").                                                                                            |
| Status dot         | The dot must NOT be the only cue for active state. Production also uses the `--active` modifier + the "Actif" badge to ensure colorblind users see the status. |
| Color contrast     | `--green-700` (`#0E6B3F`) on `#E6F7EE` bg: WCAG AAA (8.4:1).                                                                                                   |
| Reduced motion     | The icon-dot ping is implemented via `box-shadow` extension, not animation, so `prefers-reduced-motion` doesn't need special handling here.                    |

---

## Do / Don't

✅ **Do**: keep the icon, name, and meta consistent across all 3 modes (don't make some 1 line and others 2).
✅ **Do**: change the icon background and text color when the mode becomes active — let the row "light up" subtly.
✅ **Do**: place the action ("Apply" button or "Actif" badge) in the same column for all modes.

❌ **Don't**: use the amber accent for the active state. Active = green (it's a status), amber = light is on.
❌ **Don't**: add a third line of meta. If you need more info, expand the mode in place on click or open a detail.
❌ **Don't**: replace the icon with a category-tinted icon per mode. The Layers icon is shared on purpose — modes are abstract groupings, not equipment categories.

---

## React mapping (proposal)

```tsx
type ModeRowProps = {
  mode: Mode;
  isActive: boolean;
  onApply: () => void;
};

<ModeRow mode={modes[0]} isActive={false} onApply={…} />
<ModeRow mode={modes[2]} isActive={true} onApply={…} />  // shows "Actif" badge
```

When `isActive === true`, render `.mode-row--active` + the badge. When false, render the Apply button.

---

## See also

- [recipe-row.md](recipe-row.md) — Same panel, different pattern (recipes have 3 action buttons on row 2).
- [eq-row.md](eq-row.md) — Equipment row using the same grid for alignment.
- [chip-state.md](chip-state.md) — The "Actif" badge pattern.
