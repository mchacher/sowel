# Zone commands (`zcmds`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> The mini-toolbar of global zone commands (lights on/off, shutters ↑■↓) that sits on its own line just below the strip.

---

## Anatomy

```
┌───────────────────────────────────────┐
│ [💡] [💡✗] | [↑] [■] [↓]              │  .zcmds (content-width, left-aligned)
└───────────────────────────────────────┘
   lights      sep    shutters
   group              group
```

The bar is **always left-aligned** (content-width). The user explicitly chose left over center / right. It sits below the strip on its own line (left-aligned naturally, no flex magic needed).

---

## Variants

There are no variants. The bar contains 5 icon-only buttons grouped by category, with a thin vertical separator between groups.

---

## States

| Element          | Default                         | Hover                                   |
| ---------------- | ------------------------------- | --------------------------------------- |
| Container        | white bg, line border, radius 8 | unchanged                               |
| Light button     | transparent bg, `--n-600` icon  | bg `--a-50`, text `--a-ink`             |
| Light-off button | transparent                     | bg `--n-100`, text `--n-700`            |
| Shutter button   | transparent                     | bg `--shutter-50`, text `--shutter-500` |

The variant of hover color (amber for lights, neutral for off, slate for shutters) telegraphs which category you're acting on **before** you click.

---

## Slots

The container holds **5 buttons** in this exact order:

1. Tout allumer — `data-cat="light"`
2. Tout éteindre — `data-cat="light-off"` (lightbulb-off icon, not lightbulb + slash)
3. Separator `.zcmds__sep`
4. Ouvrir volets — `data-cat="shutter"`
5. Stop volets — `data-cat="shutter"` (square stop icon)
6. Fermer volets — `data-cat="shutter"`

---

## Code

```html
<div class="zcmds" aria-label="Commandes globales">
  <button class="zcmds__btn" data-cat="light" title="Tout allumer">
    <svg>… Lightbulb …</svg>
  </button>
  <button class="zcmds__btn" data-cat="light-off" title="Tout éteindre">
    <svg>… LightbulbOff …</svg>
  </button>
  <span class="zcmds__sep"></span>
  <button class="zcmds__btn" data-cat="shutter" title="Ouvrir volets">
    <svg>… ChevronUp …</svg>
  </button>
  <button class="zcmds__btn" data-cat="shutter" title="Stop">
    <svg>… Square …</svg>
  </button>
  <button class="zcmds__btn" data-cat="shutter" title="Fermer volets">
    <svg>… ChevronDown …</svg>
  </button>
</div>
```

```css
.zcmds {
  display: inline-flex;
  align-items: center;
  background: var(--n-0);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 0.25rem 0.35rem;
  margin-bottom: 0.25rem;
  gap: 1px;
}
.zcmds__sep {
  width: 1px;
  height: 16px;
  background: var(--n-200);
  margin: 0 0.3rem;
  flex: none;
}
.zcmds__btn {
  width: 36px;
  height: 34px;
  background: transparent;
  border: none;
  color: var(--n-600);
  cursor: pointer;
  border-radius: var(--r-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 160ms,
    color 160ms;
  flex: none;
  padding: 0;
}
.zcmds__btn svg {
  width: 16px;
  height: 16px;
}
.zcmds__btn[data-cat="light"]:hover {
  background: var(--a-50);
  color: var(--a-ink);
}
.zcmds__btn[data-cat="light-off"]:hover {
  background: var(--n-100);
  color: var(--n-700);
}
.zcmds__btn[data-cat="shutter"]:hover {
  background: var(--shutter-50);
  color: var(--shutter-500);
}
```

---

## Mobile variant (`.mob__zcmds`)

Same layout, slightly smaller (32×30 buttons, 14px icons), still left-aligned content-width on its own row:

```css
.mob__zcmds-btn {
  width: 32px;
  height: 30px;
  /* ... else identical */
}
.mob__zcmds-btn svg {
  width: 14px;
  height: 14px;
}
```

---

## Behavior

| Click         | Backend action                   |
| ------------- | -------------------------------- |
| Tout allumer  | `allLightsOn` order for the zone |
| Tout éteindre | `allLightsOff`                   |
| Ouvrir volets | `allShuttersOpen`                |
| Stop          | `allShuttersStop`                |
| Fermer volets | `allShuttersClose`               |

These are existing zone-level orders documented in spec 021 (V0.8f Zone commands).

---

## Accessibility

| Concern           | Implementation                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container role    | `<div role="toolbar" aria-label="Commandes globales">` for keyboard navigation between buttons.                                                        |
| Icon-only buttons | Each must have `aria-label` AND `title`. Don't rely on title alone.                                                                                    |
| Touch target      | 36 × 34 (desktop) — below 44×44. Production must extend hit area or bump visible size on mobile.                                                       |
| Focus indicator   | Browser default outline acceptable (white bg + primary outline visible).                                                                               |
| Color contrast    | Icon color `--n-600` on white: 11.6:1 — AAA. Hover-tinted bgs all pass AA.                                                                             |
| Disabled state    | When the zone has 0 lights, hide the 2 light buttons. When 0 shutters, hide the 3 shutter buttons + separator. Don't show disabled greyed-out buttons. |

---

## Do / Don't

✅ **Do**: keep the bar left-aligned and content-width. The user explicitly chose this over center/right.
✅ **Do**: use icon-only with tooltips. Labels were rejected as too verbose ("Allumer les lumières" repeated 4 times).
✅ **Do**: use 3 shutter buttons (open / stop / close). Two-button (open/close) loses the stop affordance, which is critical mid-motion.

❌ **Don't**: span the bar full-width. It's a focused tool, not a banner.
❌ **Don't**: re-add long text labels. Tooltips suffice on desktop, mobile shows tooltips via long-press or label-on-tap.
❌ **Don't**: split into two separate widgets (one for lights, one for shutters). One bar = one mental model.

---

## React mapping (proposal)

```tsx
<ZoneCommands zoneId={zoneId}>
  <ZCmdsBtn cat="light" title="Tout allumer" onClick={() => orderAllLightsOn()} />
  <ZCmdsBtn cat="light-off" title="Tout éteindre" onClick={() => orderAllLightsOff()} />
  <ZCmdsSep />
  <ZCmdsBtn cat="shutter" title="Ouvrir" onClick={() => orderAllShutters("open")} />
  <ZCmdsBtn cat="shutter" title="Stop" onClick={() => orderAllShutters("stop")} />
  <ZCmdsBtn cat="shutter" title="Fermer" onClick={() => orderAllShutters("close")} />
</ZoneCommands>
```

Production may hide light-related buttons if `zone.lightsTotal === 0`, etc.

---

## See also

- [strip.md](strip.md) — Sits immediately above
- [shutter-grp.md](shutter-grp.md) — Per-row equivalent (3 buttons per shutter)
- Spec 021 — V0.8f Zone commands (backend reference)
