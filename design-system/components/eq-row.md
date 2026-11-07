# Equipment row (`eq-row`)

> A row inside the Équipements panel that displays a single equipment (light, shutter, sensor, thermostat…). The pattern is shared with `mode-row` and `recipe-row` to maintain visual alignment across panels.

---

## Anatomy

```
┌─────────┬──────────────────┬──────────┬───────┬─────────┐
│ [icon]  │ Appliques x 2    │ [slider] │ 4 %   │ [power] │
│ 32×32   │ flex 1           │ auto     │ auto  │ 32×26   │
└─────────┴──────────────────┴──────────┴───────┴─────────┘
        ↑                                              ↑
        Grid: 32px 1fr auto auto auto, gap .85rem
        Padding: .55rem 1.1rem, min-height 52px
```

---

## Variants

The equipment type drives the **icon** (background tint + icon glyph) and the **right-side controls**. The base grid is the same.

| Type               | Icon class                                                                      | Right controls                                          | Example                   |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------- |
| `light_onoff`      | `.eq__icon--light` (or `--light-on` when on)                                    | `.power-btn`                                            | `Spots` row               |
| `light_dimmable`   | `.eq__icon--light` / `--light-on`                                               | `.eq__slider` + `.eq__value` + `.power-btn`             | `Appliques x 2`           |
| `shutter`          | `.eq__icon--shutter`                                                            | `.eq__slider--shutter` + `.chip-state` + `.shutter-grp` | `Volet Ouest`             |
| `sensor`           | `.eq__icon--sensor`                                                             | `.sensor-val` + `.chip-state`                           | `PIRL · 2548 lx · RAS`    |
| `media_player`     | `.eq__icon--media`                                                              | `.chip-state` ("OFF")                                   | `TV`                      |
| `thermostat`       | inline-styled icon (info color, or amber when heating — `.therm-icon--heating`) | `.therm-current` + `.therm-target` (±) + `.power-btn`   | `PAC`                     |
| `energy_meter`     | inline-styled icon (amber)                                                      | `.energy-val` + meta                                    | `Shelly Grid · 13.19 kWh` |
| `weather_forecast` | inline-styled icon (info)                                                       | `.forecast-row` (5 days inline)                         | `Prévisions Météo`        |
| `button` (remote)  | neutral icon                                                                    | `.chip-state--press` ("single 14h27")                   | `Remote Marc`             |
| `gate`             | green-tinted icon                                                               | `.chip-state` + single `.gate-cmd` button               | `Portail jardin`          |
| `water_valve`      | cyan-tinted icon                                                                | `.water-val` + `.chip-state` + `.power-btn`             | `Vanne potager`           |

The full list of 21 equipment types maps to one of these visual shapes — see [components.md § Equipment type coverage](../components.md).

---

## States

### Row-level

| State   | How                      | Effect                                             |
| ------- | ------------------------ | -------------------------------------------------- |
| Default | none                     | white bg, 1 px line top border                     |
| Hover   | `:hover`                 | bg `var(--n-25)`                                   |
| Cursor  | `cursor: pointer` always | implies clickable row (opens detail in production) |

### Icon-level (the "live" cue)

| State           | Class                                                  | Effect                                                                             |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Off             | base `--icon-bg` (light tint) + `--icon-fg` (mid tint) | calm, neutral                                                                      |
| **Light on**    | `.eq__icon--light-on`                                  | bg switches to `var(--a-500)` (yellow), fg becomes white, **animated glow** ripple |
| Shutter closed  | (data-driven slider position)                          | slider knob navy, chip-state shows "Fermé"                                         |
| Sensor detected | `.chip-state--detected`                                | green tinted "Détecté Xs"                                                          |

The light-on state is the **single accent moment** of the entire UI. Reserved exclusively to "a light is on right now."

---

## Slots

A row is a 5-column CSS grid. Each column accepts a single child.

| Column | Slot            | Required | Common content                             |
| ------ | --------------- | -------- | ------------------------------------------ |
| 1      | Icon            | yes      | `.eq__icon` 32×32 with type modifier       |
| 2      | Name            | yes      | `.eq__name` (16 px body)                   |
| 3      | Primary control | optional | slider, current temp display, energy value |
| 4      | Secondary value | optional | `.eq__value` percent, chip-state, badge    |
| 5      | Action          | optional | `.power-btn`, `.shutter-grp`, `.gate-cmd`  |

Empty slots collapse to 0 px due to `grid-template-columns: 32px 1fr auto auto auto`.

---

## Code

### Light row (on, 4%)

```html
<div class="eq">
  <div class="eq__icon eq__icon--light-on">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"
      />
      <path d="M9 18h6M10 22h4" />
    </svg>
  </div>
  <span class="eq__name">Appliques x 2</span>
  <div class="eq__slider">
    <div class="eq__slider-fill" style="width:4%"></div>
    <div class="eq__slider-knob" style="left:4%"></div>
  </div>
  <div class="eq__value" style="color:var(--a-600)">4 %</div>
  <button class="power-btn power-btn--on" aria-label="Éteindre">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  </button>
</div>
```

### Shutter row (open)

```html
<div class="eq">
  <div class="eq__icon eq__icon--shutter">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18" />
    </svg>
  </div>
  <span class="eq__name">Volet Ouest</span>
  <div class="eq__slider">
    <div class="eq__slider-fill eq__slider-fill--shutter" style="width:100%"></div>
    <div class="eq__slider-knob eq__slider-knob--shutter" style="left:100%"></div>
  </div>
  <span class="chip-state" style="background:var(--green-50);color:var(--green-700)">Ouvert</span>
  <div class="shutter-grp">
    <button class="shutter-btn is-active" aria-label="Ouvrir">…</button>
    <button class="shutter-btn" aria-label="Stop">…</button>
    <button class="shutter-btn" aria-label="Fermer">…</button>
  </div>
</div>
```

### CSS (key rules)

```css
.eq {
  display: grid;
  grid-template-columns: 32px 1fr auto auto auto;
  gap: 0.85rem;
  align-items: center;
  padding: 0.55rem 1.1rem;
  min-height: 52px;
  box-sizing: border-box;
  border-top: 1px solid var(--line);
  cursor: pointer;
}
.eq:hover {
  background: var(--n-25);
}

.eq__icon {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--icon-bg, var(--n-50));
  color: var(--icon-fg, var(--n-500));
}
.eq__icon svg {
  width: 15px;
  height: 15px;
}
.eq__icon--light {
  /* Off is neutral: amber appears only while the light is on (spec 196). */
  --icon-bg: var(--n-50);
  --icon-fg: var(--n-400);
}
.eq__icon--light-on {
  --icon-bg: var(--a-500);
  --icon-fg: var(--a-on); /* never white on amber: 1.70:1 */
  animation: glow 3.2s ease-in-out infinite;
}
.eq__icon--shutter {
  --icon-bg: var(--shutter-50);
  --icon-fg: var(--shutter-500);
}
.eq__icon--sensor {
  --icon-bg: var(--sensor-50);
  --icon-fg: var(--sensor-500);
}
.eq__icon--media {
  --icon-bg: var(--media-50);
  --icon-fg: var(--media-500);
}

.eq__name {
  font-weight: 500;
  font-size: 0.88rem;
  color: var(--n-800);
}
```

---

## Accessibility

| Concern            | Implementation                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row clickability   | The row is `cursor: pointer` but should be wrapped in a `<button>` or have `role="button"` and keyboard handler when used to open detail. The mock uses `<div>` for visual demo.                   |
| Power button label | `aria-label="Allumer Appliques x 2"` (production pattern). Never just "Allumer" alone.                                                                                                             |
| Slider             | Production uses `<input type="range">` underneath the visual slider for keyboard control. The mock shows the visual only.                                                                          |
| Color contrast     | `--n-800` text on `--n-0` bg: AAA. `--a-600` (`#D4A41C`) on white: **WCAG AA** for normal text (4.6:1). Use `--n-800` for primary text wherever possible.                                          |
| Touch target       | `.power-btn` is 32 × 26 px. Below Apple HIG 44 × 44. **Action: production should keep the visual 32×26 but add `padding` to expand the clickable area** (e.g. negative margins + larger hit zone). |
| Reduced motion     | `.eq__icon--light-on` glow animation is disabled by `prefers-reduced-motion: reduce` (see [motion.md](../motion.md)).                                                                              |

---

## Do / Don't

✅ **Do**: keep row height fixed at 52 px. The cross-panel alignment depends on it.
✅ **Do**: tint the **icon** by equipment type, never the row background.
✅ **Do**: use amber on the on-state of a light and nothing else.
✅ **Do**: collapse unused columns (don't pad with empty divs — let the grid auto-shrink).

❌ **Don't**: put a battery indicator on the row. Battery monitoring is a dedicated future feature; the zone view stays focused on state and commands.
❌ **Don't**: add a "⚡ controlled by recipe" zap badge after the name. The user rejected this — context comes from the Activity feed or the Comportements panel.
❌ **Don't**: stack a secondary line of text under the name unless the row is a `mode-row` (which has its own pattern at 2 stacked lines + icon).
❌ **Don't**: invent new equipment type modifiers. If a type doesn't fit the existing six patterns, propose a new spec first.

---

## React mapping (proposal)

```tsx
type EqRowProps = {
  type: EquipmentType;        // one of 21 types
  icon: ReactNode;
  name: string;
  state: 'on' | 'off' | 'open' | 'closed' | …;
  value?: string;
  primaryControl?: ReactNode; // slider, etc.
  secondaryValue?: ReactNode; // chip-state, percent
  action?: ReactNode;          // power-btn, shutter-grp
  onClick?: () => void;
};
```

The icon modifier is computed from `type` + `state`. For lights, `state === 'on'` → `eq__icon--light-on`.

---

## See also

- [components/power-button.md](power-button.md) — Action atom used in rows.
- [components/slider.md](slider.md) — Primary control for dimmer / shutter position.
- [components/chip-state.md](chip-state.md) — State badge.
- [components/shutter-grp.md](shutter-grp.md) — Three-button segmented control for shutters.
