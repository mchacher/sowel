# Pill atom (`strip__pill`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> Content-width chip with an icon and a value. The building block of the zone aggregation strip and a frequent pattern across the topbar.

---

## Anatomy

```
┌─────────────────────┐
│ [🌡] 21,4 °C   [▭]  │   icon + value + optional sparkline
└─────────────────────┘
  padding .35 .65 rem
  font-size .82 rem
```

---

## Variants

| Variant | Class                  | Visual                                   |
| ------- | ---------------------- | ---------------------------------------- |
| Default | `.strip__pill`         | neutral icon + dark text                 |
| Active  | `.strip__pill--active` | amber icon + amber text (lights on)      |
| Calm    | `.strip__pill--calm`   | green icon + green text (motion at rest) |
| Alert   | `.strip__pill--alert`  | red bg + red text + pulsing dot          |

The full state set is documented in the parent [strip.md](strip.md).

---

## Slots

| Slot                 | Class                | Content                                |
| -------------------- | -------------------- | -------------------------------------- |
| Icon (required)      | `.strip__pill-icon`  | 14×14 SVG, color via `--c` custom prop |
| Value (required)     | `.strip__pill-val`   | mono number + optional `.u` unit       |
| Meta (optional)      | `.strip__pill-meta`  | secondary text ("39 min")              |
| Sparkline (optional) | `.strip__pill-spark` | 48×16 mini chart inline                |

---

## Code

```html
<!-- Sensor pill -->
<div class="strip__pill" title="Température · 3 capteurs">
  <svg class="strip__pill-icon" style="--c:var(--info-500)">
    <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z" />
  </svg>
  <span class="strip__pill-val">21,4<span class="u">°C</span></span>
  <svg class="strip__pill-spark">…</svg>
</div>

<!-- Calm pill (motion sensor at rest) -->
<div class="strip__pill strip__pill--calm" title="Mouvement · calme depuis 39 min">
  <svg class="strip__pill-icon">…person-standing…</svg>
  <span class="strip__pill-val">Calme</span>
  <span class="strip__pill-meta">39 min</span>
</div>

<!-- Active pill (1 of 3 lights on) -->
<div class="strip__pill strip__pill--active" title="1 lumière allumée sur 3">
  <svg class="strip__pill-icon">…lightbulb…</svg>
  <span class="strip__pill-val">1<span class="u">/ 3</span></span>
</div>

<!-- Alert pill -->
<div class="strip__pill strip__pill--alert" title="Porte-fenêtre ouverte">
  <svg class="strip__pill-icon">…door-open…</svg>
  <span class="strip__pill-val">1 ouverte</span>
</div>
```

---

## Accessibility

| Concern        | Implementation                                                                    |
| -------------- | --------------------------------------------------------------------------------- |
| Title tooltip  | Production must surface this as visible text on mobile (no hover available).      |
| Alert role     | `role="alert"` for critical alerts (smoke, leak). `aria-live="polite"` otherwise. |
| Sparkline      | `aria-hidden="true"` — decorative. The text value carries the data.               |
| Color contrast | All combinations measured in [accessibility.md § 3](../accessibility.md).         |

---

## Do / Don't

✅ **Do**: use the `--c` CSS custom prop on the icon for per-pill color (e.g. lux pill has `--c:var(--info-500)`).
✅ **Do**: include the unit inside `<span class="u">` so its font-size scales relative to the value.
✅ **Do**: keep sparklines to 48–60 px wide, 14–18 px tall.

❌ **Don't**: nest pills inside pills. The atom doesn't compose recursively.
❌ **Don't**: use the alert variant for warnings (`prefer chip-state warning style`). Alert is for critical state.

---

## See also

- [strip.md](strip.md) — Parent container
- [chip-state.md](chip-state.md) — Cousin atom for state badges (Ouvert, RAS, …)
