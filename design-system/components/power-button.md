# Power button atom (`power-btn`)

> Rounded square 32×26 button used to toggle on/off the most common interactive equipment (lights, water valves, switches, gates).

---

## Anatomy

```
┌─────┐
│ ⏻   │   32 × 26, radius 6, icon Lucide Power
└─────┘
```

---

## Variants

| Variant        | Class                                          | Visual                                                                                                    |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Off (default)  | `.power-btn`                                   | bg `--n-50`, icon `--n-400`                                                                               |
| **On**         | `.power-btn--on`                               | bg `--a-500`, icon `--a-on`. Amber means "on or running now" (tokens.md §1.2)                             |
| Shutter closed | `.power-btn--shutter-closed` (alternative use) | bg `--shutter-500`, icon white. Used in patterns where a power-btn substitutes for the shutter ↑■↓ group. |

---

## States

| State   | Effect                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------ |
| Default | calm bg + muted icon                                                                             |
| Hover   | (production may add subtle bg shift; mock doesn't have it)                                       |
| **On**  | full amber bg + `--a-on` icon; the parent `.eq__icon--light-on` may also have a `glow` animation |

---

## Code

```html
<!-- Off state -->
<button class="power-btn" title="Allumer Applique x 1" aria-label="Allumer Applique x 1">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
</button>

<!-- On state (light is on) -->
<button
  class="power-btn power-btn--on"
  title="Éteindre Appliques x 2"
  aria-label="Éteindre Appliques x 2"
>
  <svg>… same icon …</svg>
</button>
```

```css
.power-btn {
  width: 32px;
  height: 26px;
  border-radius: var(--r-sm);
  background: var(--n-50);
  color: var(--n-400);
  border: 1px solid var(--line-2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.power-btn svg {
  width: 13px;
  height: 13px;
}
.power-btn--on {
  background: var(--a-500);
  color: var(--a-on); /* on-active: never white on amber */
  border-color: var(--a-500);
}
```

Content on an amber fill is `--a-on` (`on-active`) in both themes: white on `#F2C035` is 1.7:1.

---

## Accessibility

| Concern | Implementation |
| ---------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Icon-only button | Requires `aria-label="Allumer …"` AND `title` for redundancy. |
| State change | When toggled, the button must announce the new state. Use `aria-pressed="true             | false"`for true on/off semantics, or a`role="switch" aria-checked` if used in a switch context. |
| Touch target | 32 × 26 is below 44 × 44. Mitigate via padding-based hit area expansion in production. |
| Color contrast | `--a-on` icon on amber `--a-500`: 10.2:1. Off icon `--n-400` on `--n-50`: 4.8:1 — AA. |
| Reduced motion | The on-state glow is on the parent icon, not the button. Honors `prefers-reduced-motion`. |

---

## Do / Don't

✅ **Do**: use `--on` only for live light state. Don't use it as a "primary CTA" pattern elsewhere.
✅ **Do**: keep the button rectangular (rounded-square), not circular. The user explicitly preferred this over a circle.

❌ **Don't**: use this button for shutters. Shutters use [shutter-grp](shutter-grp.md) (3-button group).
❌ **Don't**: enlarge to 44 × 44 visually. The 32×26 size is part of the row's vertical rhythm.

---

## See also

- [eq-row.md](eq-row.md) — Parent row
- [shutter-grp.md](shutter-grp.md) — For shutter equipment
