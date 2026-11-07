# Slider atom (`eq__slider`)

> Horizontal track + fill bar + draggable knob. Used on light_dimmable equipment for brightness and on shutter equipment for position.

---

## Anatomy

```
┌──────────────────────────┐
│ ████████○─────────────── │   track + fill + knob
└──────────────────────────┘
   96 × 5 px (track)        knob 12 px circle on top
```

---

## Variants

| Variant        | Class                                                                                          | Used for           |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------ |
| Light dimmable | `.eq__slider` + `.eq__slider-fill` (amber) + `.eq__slider-knob` (amber border)                 | brightness 0–100 % |
| Shutter        | `.eq__slider` + `.eq__slider-fill--shutter` (navy) + `.eq__slider-knob--shutter` (navy border) | position 0–100 %   |

The track itself is shared. Only the fill bar and knob border change color via modifier.

---

## Code

### Light dimmable

```html
<div class="eq__slider">
  <div class="eq__slider-fill" style="width:4%"></div>
  <div class="eq__slider-knob" style="left:4%"></div>
</div>
```

### Shutter

```html
<div class="eq__slider">
  <div class="eq__slider-fill eq__slider-fill--shutter" style="width:100%"></div>
  <div class="eq__slider-knob eq__slider-knob--shutter" style="left:100%"></div>
</div>
```

```css
.eq__slider {
  width: 96px;
  height: 5px;
  background: var(--n-100);
  border-radius: var(--r-full);
  position: relative;
}
.eq__slider-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--a-500);
}
.eq__slider-fill--shutter {
  background: var(--shutter-500);
}

.eq__slider-knob {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  background: var(--n-0);
  border: 2px solid var(--a-500);
  border-radius: 50%;
  cursor: grab;
}
.eq__slider-knob--shutter {
  border-color: var(--shutter-500);
}
```

The position of the knob is set via inline `style="left: N%"`. The fill bar uses `width: N%`. Both bind to the same value.

---

## Accessibility

| Concern            | Implementation                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Underlying control | **In production, wrap the visual slider with an `<input type="range">`** for keyboard, screen reader, and OS-level interaction. The mock is visual-only.                      |
| Labeling           | The slider must have `aria-label` matching the equipment name (e.g. `"Luminosité Appliques x 2"`) — or wire `aria-labelledby` to the row's name element.                      |
| Step               | Production should set `step="1"` for percent sliders (0–100).                                                                                                                 |
| Touch              | The knob (12 px) is below 44 × 44. Mobile users drag the **track region** — the actual `<input type="range">` is full-width and tappable; the visual knob is purely cosmetic. |
| Reduced motion     | No animation on the slider. Position updates are instant.                                                                                                                     |
| Color contrast     | Knob border `--a-500` on white bg: 1.9:1 (decorative — the position is encoded by the FILL bar, which has higher contrast).                                                   |

---

## Do / Don't

✅ **Do**: pair the slider with a `.eq__value` number (e.g. "4 %") for an unambiguous read.
✅ **Do**: use the amber fill for lights, the shutter color for shutters. Stay consistent.
✅ **Do**: wrap with a real `<input type="range">` in production for native keyboard / screen reader support.

❌ **Don't**: use the slider as a progress bar (e.g. for a load state). Use a separate progress component if needed.
❌ **Don't**: make the knob larger than 12 px. The visual hierarchy of the row depends on the slider being small/secondary to the icon.
❌ **Don't**: animate the fill bar on value change. The slider should feel direct, not laggy.

---

## React mapping (proposal)

```tsx
type SliderProps = {
  value: number; // 0–100
  onChange: (v: number) => void;
  variant?: "light" | "shutter";
  ariaLabel: string;
};

<Slider
  value={brightness}
  onChange={setBrightness}
  variant="light"
  ariaLabel="Luminosité Appliques x 2"
/>;
```

Internally renders the visual track + fill + knob AND a hidden `<input type="range">` overlaid for native interaction.

---

## See also

- [eq-row.md](eq-row.md) — Parent
- [power-button.md](power-button.md) — Companion on/off button on the same row
