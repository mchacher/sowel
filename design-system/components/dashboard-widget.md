# Dashboard widget (`dashboard-widget`)

> Large card used on the Dashboard page. One widget = one equipment. Different layout from `eq-row` because the Dashboard is a glance-first surface, not a list.

---

## Anatomy

```
┌────────────────────────────────────────┐
│         Portail                        │   .widget__title  (centered, 14 px weight 500)
│                                        │
│                                        │
│             [SVG art]                  │   .widget__art   (line-art illustration)
│                                        │
│                                        │
│  ────────────────────────────────      │
│             Ouvert                     │   .widget__state (chip-state)
└────────────────────────────────────────┘
   273 × 240 desktop / × 160 mobile
   12 px padding, 10 px radius
```

---

## Variants per equipment type

Each widget has a distinct **SVG illustration** + a specific footer layout. The illustration is **line-art at 80–120 px** (much larger than the 16–24 px Lucide icons used elsewhere).

| Type                              | Illustration                                 | Footer content                                         |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| Gate / Garage                     | gate or garage door drawing                  | state chip ("Ouvert" / "Fermé")                        |
| Shutter                           | shutter at current position                  | chip + 3-button `shutter-grp`                          |
| Pool cover                        | horizontal slide drawing                     | chip + **horizontal** `shutter-grp` (left/stop/right)  |
| Thermostat                        | thermometer SVG (amber fill if heating)      | value + power-btn + target ±                           |
| Pool heat pump                    | thermometer SVG with red fill = "heating ON" | value + target ±                                       |
| Weather station                   | sun/cloud SVG                                | inline multi-value (temp / humidity / wind / pressure) |
| Weather forecast                  | weather glyph (cloud + sun + lightning)      | current° / forecast° + status + humidity + wind        |
| Light                             | bulb SVG (amber fill when on)                | chip + power-btn                                       |
| Appliance (washing machine, etc.) | machine drawing                              | state chip + power-btn                                 |
| Pool pump                         | pump drawing                                 | chip ("ON"/"OFF") + runtime + power-btn                |
| Energy meter                      | meter drawing                                | current kWh value                                      |

---

## States

| State                 | Class                            | Effect                                                         |
| --------------------- | -------------------------------- | -------------------------------------------------------------- |
| Default               | `.widget`                        | white bg, no border, card shadow (none in dark), 10 px radius  |
| Hover                 | `.widget:hover`                  | (production uses subtle bg shift; mock unspecified)            |
| **Edit mode**         | parent has `.dashboard--editing` | each widget gets edit chrome overlay (drag, customize, delete) |
| Drag (during reorder) | `.widget.is-dragging`            | reduced opacity + cursor grabbing                              |

---

## Edit mode chrome

When the dashboard is in edit mode, each widget gets four small icon controls at its top edge:

```
┌────────────────────────────────────────┐
│ ⋮⋮          🎨            ×             │   .widget__edit-overlay
│        Portail                         │
│             [SVG art]                  │
│             Ouvert                     │
└────────────────────────────────────────┘
   drag      customize    delete
   handle    (palette)
```

- `⋮⋮` — drag handle (top-left), enables reordering
- `🎨` — palette / customize (top-center-right), opens widget settings panel
- `×` — delete (top-right), removes widget after confirm
- Optional chart icon for chart-type widgets (top-center)

---

## Code

### Base widget shell

```html
<div class="widget">
  <h3 class="widget__title">Portail</h3>
  <div class="widget__art">
    <!-- Illustration SVG (line-art, 100×80 typical) -->
    <svg viewBox="0 0 200 120">…</svg>
  </div>
  <div class="widget__footer">
    <span class="chip-state" style="background:var(--green-50);color:var(--green-700)">Ouvert</span>
  </div>
</div>
```

### Shutter widget (3 controls)

```html
<div class="widget">
  <h3 class="widget__title">RDC</h3>
  <div class="widget__art">…</div>
  <div class="widget__footer">
    <span class="chip-state" style="background:var(--green-50);color:var(--green-700)">Ouvert</span>
    <div class="shutter-grp">
      <button class="shutter-btn">↑</button>
      <button class="shutter-btn">■</button>
      <button class="shutter-btn">↓</button>
    </div>
  </div>
</div>
```

### Thermostat widget

```html
<div class="widget widget--therm">
  <h3 class="widget__title">PAC</h3>
  <div class="widget__art">
    <svg>…thermometer with amber fill if heating…</svg>
    <div class="widget__current">21.0<span class="u">°C</span></div>
    <button class="power-btn power-btn--on">…</button>
  </div>
  <div class="widget__target">
    <button class="therm-btn">−</button>
    <span class="therm-target-val">18.0°C</span>
    <button class="therm-btn">+</button>
  </div>
</div>
```

### Edit mode overlay

```html
<div class="widget dashboard--editing">
  <div class="widget__edit-overlay">
    <button class="widget__drag" aria-label="Glisser pour réordonner"><svg>…</svg></button>
    <button class="widget__customize" aria-label="Personnaliser"><svg>…palette…</svg></button>
    <button class="widget__delete" aria-label="Supprimer"><svg>…×…</svg></button>
  </div>
  <h3 class="widget__title">Portail</h3>
  …
</div>
```

### CSS

```css
.widget {
  background: var(--n-0);
  border-radius: var(--r-md); /* 10 px; no border: box-shadow var(--sh-card) (spec 196) */
  box-shadow: var(--sh-card);
  padding: 12px;
  display: flex;
  flex-direction: column;
  height: 240px; /* desktop */
  overflow: hidden;
  cursor: pointer;
}
@media (max-width: 640px) {
  .widget {
    height: 160px;
    padding: 10px;
  }
}

.widget__title {
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--n-800);
  text-align: center;
  margin: 0 0 8px;
}

.widget__art {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-500); /* primary stroke for line-art */
}
.widget__art svg {
  max-width: 100%;
  max-height: 100%;
}

.widget__footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  margin-top: 8px;
}

.widget__edit-overlay {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 2;
}
.widget__drag,
.widget__customize,
.widget__delete {
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  color: var(--n-400);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.widget__drag {
  cursor: grab;
}
.widget__drag:hover,
.widget__customize:hover {
  color: var(--n-700);
}
.widget__delete:hover {
  color: var(--red-500);
}
```

---

## Why a widget is NOT an `eq-row`

|              | eq-row (zone view)                       | widget (dashboard)                               |
| ------------ | ---------------------------------------- | ------------------------------------------------ |
| Purpose      | Compact control in a list of N equipment | Single equipment glance + control                |
| Layout       | 5-col grid, 52 px tall                   | 273×240 card with 3 zones (title / art / footer) |
| Icon         | 32×32 Lucide icon                        | 80–120 px line-art SVG illustration              |
| Density      | Many per zone                            | A few hand-picked per dashboard                  |
| Mental model | "what's in this zone"                    | "what do I check at a glance"                    |

They serve **different purposes** on different pages. Production rightly chose two patterns. The design system embraces both.

---

## Illustration system (note)

The line-art SVGs used in widget\_\_art are **production-specific** and not (yet) part of the design system. They live in `ui/src/components/dashboard/widget-icons.ts`.

Characteristics:

- Stroke-only (no fill) for most equipment
- `--p-500` (navy) is the primary stroke color
- `--a-500` (amber) is used for "live" fill (heated thermometer, lit bulb)
- Sizes range 60–120 px depending on widget aspect

**Status**: documented here for awareness. A separate `illustration-system.md` spec is **out of scope for design system v1.0** but proposed for v1.1.

---

## Accessibility

| Concern        | Implementation                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card role      | A widget is a `<article role="group" aria-label="Widget Portail">` for screen reader grouping.                                                                                  |
| Title          | Use `<h3>` (page H1 is "Dashboard", widgets are H3 sections).                                                                                                                   |
| Illustration   | `aria-hidden="true"` on the SVG (decorative). The chip + value carry the state.                                                                                                 |
| Click target   | The whole card is `cursor: pointer` — production should make it an actual button or use `role="button"` if the click triggers an action (typically opens the equipment detail). |
| Edit mode      | Drag handle needs `aria-grabbed` + keyboard reorder support. Delete needs `aria-haspopup="dialog"` if it confirms.                                                              |
| Color contrast | Title `--n-800` on `--n-0`: AAA. State chips already audited in [chip-state.md](chip-state.md).                                                                                 |
| Touch target   | Edit chrome buttons are 22×22 — extend hit area via padding.                                                                                                                    |

---

## Do / Don't

✅ **Do**: keep widget height fixed (`240` desktop / `160` mobile). The grid alignment depends on it.
✅ **Do**: center the title and the illustration. The widget is a centerpiece, not a list row.
✅ **Do**: reuse atoms (`chip-state`, `power-btn`, `shutter-grp`, `therm-target`) for the footer controls.
✅ **Do**: use the amber accent only on the on-state (lit bulb, heating thermometer). Same rule as everywhere else.

❌ **Don't**: replace the illustration with the Lucide icon used in eq-row. The widget needs the larger illustration for the dashboard glance.
❌ **Don't**: stack widgets vertically inside a widget. One widget = one equipment.
❌ **Don't**: tint the card background by category. The illustration carries the visual identity.
❌ **Don't**: use widget cards inside zone view rows. Different contexts, different patterns.

---

## React mapping (proposal)

```tsx
type WidgetProps = {
  equipment: Equipment;
  illustration: ReactNode; // line-art SVG
  state: { label: string; tone: "success" | "neutral" | "warning" };
  controls?: ReactNode; // shutter-grp, power-btn, etc.
  editing?: boolean;
  onDrag?: () => void;
  onCustomize?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
};

<Widget
  equipment={portailEq}
  illustration={<GateIllustration position="open" />}
  state={{ label: "Ouvert", tone: "success" }}
  onClick={() => navigate(`/equipment/${portailEq.id}`)}
/>;
```

Widgets are pluggable: the dashboard reads a per-user list of widget refs and renders accordingly.

---

## See also

- [eq-row.md](eq-row.md) — Different pattern for the zone view.
- [shutter-grp.md](shutter-grp.md) — Reused in shutter / pool-cover widgets (with horizontal variant for pool covers).
- [chip-state.md](chip-state.md) — Reused in widget footers.
- Production reference: `ui/src/components/dashboard/WidgetGrid.tsx` and `widget-icons.ts`.
