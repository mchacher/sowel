# Chip-state atom (`chip-state`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> Compact text badge for a single equipment state. Smaller than a pill, no icon, no number. Used on equipment rows.

---

## Anatomy

```
┌───────┐
│  RAS  │   .chip-state — 11 px text, uppercase off, weight 600
└───────┘
```

---

## Variants

| Variant          | Class                                                      | Semantic          |
| ---------------- | ---------------------------------------------------------- | ----------------- |
| Neutral          | `.chip-state`                                              | RAS, Inactif, OFF |
| On / open        | `.chip-state` + inline style `bg:green-50 color:green-700` | Ouvert, Allumé    |
| Closed / off     | `.chip-state--closed`                                      | Fermé, Éteint     |
| OFF (greyed)     | `.chip-state--off`                                         | OFF, Désactivé    |
| Detected         | `.chip-state--detected`                                    | Détecté 24s       |
| Pressed (button) | `.chip-state--press`                                       | single 14h27      |

---

## Code

```html
<!-- Sensor row: motion at rest -->
<span class="chip-state">RAS</span>

<!-- Shutter row: open -->
<span class="chip-state" style="background:var(--green-50);color:var(--green-700)">Ouvert</span>

<!-- Shutter row: closed -->
<span class="chip-state chip-state--closed">Fermé</span>

<!-- Media (TV) -->
<span class="chip-state chip-state--off">OFF</span>

<!-- Motion sensor: recently detected -->
<span class="chip-state chip-state--detected">Détecté 24s</span>

<!-- Remote (button) last pressed -->
<span class="chip-state chip-state--press">single 14h27</span>
```

```css
.chip-state {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 3px 7px;
  border-radius: var(--r-xs);
  background: var(--n-100);
  color: var(--n-500);
}
.chip-state--closed {
  background: var(--shutter-50);
  color: var(--shutter-500);
}
.chip-state--off {
  background: var(--n-100);
  color: var(--n-400);
}
.chip-state--detected {
  background: var(--green-50);
  color: var(--green-700);
}
.chip-state--press {
  background: var(--p-50);
  color: var(--p-500);
}
```

---

## Accessibility

| Concern          | Implementation                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standalone state | OK as `<span>`. Don't make it interactive — if it should be clickable, it's a button.                                                                           |
| Color cue alone  | The chip's background color is a cue, but the **text label** must always carry the state. A green chip with "Ouvert" is fine. A green chip with no text is not. |
| Contrast         | All variants pass AA against their tinted background (measured in [accessibility.md § 3](../accessibility.md)).                                                 |

---

## Do / Don't

✅ **Do**: keep chip text short (1–3 words max). "Détecté 24s" is the longest acceptable.
✅ **Do**: use the inline `style="..."` override for one-off cases (e.g. "Ouvert" on `--green-*`). Don't create a `.chip-state--open` if it's used in one place.

❌ **Don't**: nest a chip-state inside another chip-state.
❌ **Don't**: use the chip as a button trigger. Make it a `<button>` instead.

---

## See also

- [eq-row.md](eq-row.md) — Most common parent
- [pill.md](pill.md) — Cousin atom for the strip
