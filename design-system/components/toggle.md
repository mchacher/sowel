# Toggle atom (`recipe__toggle`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> Pill switch (30×18) for binary enable/disable. Used exclusively on recipe rows to toggle a recipe on/off.

---

## Anatomy

```
┌───────────────┐         ┌───────────────┐
│ ●             │   OFF   │             ● │   ON
└───────────────┘         └───────────────┘
   30 × 18                  thumb slides right
   bg --n-200                bg --green-500
```

---

## States

| State | Class                 | Effect                                              |
| ----- | --------------------- | --------------------------------------------------- |
| Off   | `.recipe__toggle`     | bg `--n-200`, thumb at left                         |
| On    | `.recipe__toggle--on` | bg `--green-500`, thumb at right (translateX 12 px) |

The state change is animated via `transition: transform 180ms` on the `::after` thumb.

---

## Code

```html
<div class="recipe__toggle recipe__toggle--on" role="switch" aria-checked="true" tabindex="0"></div>
```

```css
.recipe__toggle {
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: var(--n-200);
  position: relative;
  flex: none;
  cursor: pointer;
}
.recipe__toggle::after {
  content: "";
  position: absolute;
  width: 14px;
  height: 14px;
  background: var(--n-0);
  border-radius: 50%;
  top: 2px;
  left: 2px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 180ms;
}
.recipe__toggle--on {
  background: var(--green-500);
}
.recipe__toggle--on::after {
  transform: translateX(12px);
}
```

Mobile equivalent `.mob__toggle` is identical (same 30×18 size).

---

## Accessibility

| Concern | Implementation |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Switch role | `role="switch" aria-checked="true                                                                                                     | false"`+`tabindex="0"` |
| Keyboard activation | **Space** toggles the switch (production must wire this) |
| Click vs row click | The toggle must `event.stopPropagation()` when used inside a clickable row (e.g. recipe row that opens a modal on click) |
| Visible label | The toggle has no visible label. The row's name acts as the label. Production must add `aria-labelledby` pointing to the recipe name. |
| Touch target | 30 × 18 is below 44 × 44. Mitigate via padding hit area. |
| Color contrast | Green bg on white parent: 4.1:1 (AA for UI). Thumb white on green: 8.4:1 (AAA). |

---

## Do / Don't

✅ **Do**: use only for binary enable/disable of automations / preferences.
✅ **Do**: animate the thumb. The 180 ms slide is the only motion the atom has and it's worth keeping.
✅ **Do**: keep `event.stopPropagation` on click so toggling doesn't trigger the parent row's click handler.

❌ **Don't**: use this as a checkbox in forms. Forms use `<input type="checkbox">` styled via the [modal.md](modal.md) `.mcheck__item` pattern.
❌ **Don't**: substitute a button. The switch role and Space-key handling are essential for accessibility.
❌ **Don't**: enlarge for "more touch area". The visual size is calibrated. Use padding-based hit area expansion if needed.

---

## React mapping (proposal)

```tsx
type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string; // for aria-labelledby
};

<Toggle checked={recipe.enabled} onChange={setEnabled} />;
```

The production codebase already implements an equivalent — see `ZoneRecipesSection.tsx:747-760`.

---

## See also

- [recipe-row.md](recipe-row.md) — Only parent that uses this atom
- [modal.md](modal.md) — Uses `<input type="checkbox">` in forms, not this toggle
