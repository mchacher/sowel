# Sub-category header (`cat-head`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> The thin band that visually groups rows of the same kind inside a [panel](panel.md). Examples: "Éclairages" / "Volets" / "Capteurs" inside Équipements, "Modes" / "Recettes" inside Comportements.

---

## Anatomy

```
┌─────────────────────────────────────────────────────┐
│ [icon] ÉCLAIRAGES                            [+]    │   .cat-head (36 px)
└─────────────────────────────────────────────────────┘
        ↑                                        ↑
        14×14 muted icon                         optional add button
```

**Fixed height**: 36 px. Critical for cross-panel row alignment (Éclairages on the left lines up with Modes on the right).

---

## Variants

There are no visual variants. Two optional elements:

| Element                            | When                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.cat-head__add` (+ button)        | On Modes and Recettes sub-cats (Comportements panel). Never on Équipement sub-cats (the + lives on the panel head).                          |
| `.cat-head__count` (numeric badge) | **Hidden** by CSS — the user explicitly removed count badges. The class is preserved for legacy compat but `display: none` via `tokens.css`. |

---

## States

| State          | Effect                                                       |
| -------------- | ------------------------------------------------------------ |
| Default        | bg `--n-25`, text `--n-500`, uppercase, letter-spacing .14em |
| + button hover | `.cat-head__add:hover` → bg `--p-50`, color/border `--p-500` |

The cat-head itself has no hover state — it's a label, not interactive.

---

## Code

```html
<div class="cat-head">
  <svg class="cat-head-icon">…Lightbulb…</svg>
  Éclairages
  <button class="cat-head__add" title="Ajouter un éclairage" aria-label="Ajouter un éclairage">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  </button>
</div>
```

```css
.cat-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 1.1rem;
  min-height: 36px;
  box-sizing: border-box;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--n-500);
  font-weight: 600;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: var(--n-25);
}
.cat-head-icon {
  width: 14px;
  height: 14px;
  opacity: 0.7;
}

.cat-head__add {
  margin-left: auto;
  width: 22px;
  height: 22px;
  background: transparent;
  border: 1px solid var(--n-200);
  border-radius: var(--r-xs);
  color: var(--n-500);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cat-head__add:hover {
  background: var(--p-50);
  color: var(--p-500);
  border-color: var(--p-100);
}
.cat-head__add svg {
  width: 11px;
  height: 11px;
}
```

---

## Icon usage

| Sub-category | Icon (Lucide)                                        |
| ------------ | ---------------------------------------------------- |
| Éclairages   | `Lightbulb`                                          |
| Volets       | rect+lines (custom, matches production ShutterIcons) |
| Capteurs     | `Gauge`                                              |
| Multimédia   | `Tv`                                                 |
| Autres       | `Eye` (or category-specific)                         |
| Modes        | `Layers`                                             |
| Recettes     | `ChefHat`                                            |
| Thermostat   | `Thermometer`                                        |
| Énergie      | `Zap`                                                |
| Météo        | `CloudSun`                                           |
| Eau          | water drop (custom)                                  |
| Piscine      | `Waves`                                              |

---

## Accessibility

| Concern         | Implementation                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Heading role    | Production should wrap the label in `<h3>` or use `role="heading" aria-level="3"`.               |
| Decorative icon | The leading icon is decorative — must have `aria-hidden="true"` to avoid double-announcement.    |
| + button label  | `aria-label` describing what gets added ("Ajouter une recette", not just "Ajouter").             |
| Color contrast  | `--n-500` on `--n-25`: 7.6:1 — AAA.                                                              |
| Touch target    | + button is 22 × 22 — below 44×44. Mitigation: extend hit area via padding or `::before` pseudo. |

---

## Do / Don't

✅ **Do**: keep cat-head heights identical across panels (36 px min-height).
✅ **Do**: use neutral background (`--n-25`). The user explicitly rejected category-tinted backgrounds.
✅ **Do**: add the + button only where adding is contextually sensible (Modes, Recettes — not Capteurs or Météo where equipment is bound to a device).

❌ **Don't**: add a category-colored stripe or border to cat-heads. The icon carries the category visual cue.
❌ **Don't**: show count badges next to the label. The user removed them; data is repeated elsewhere (e.g. the strip pills count "1/3 lights on").

---

## React mapping (proposal)

```tsx
type CatHeadProps = {
  icon: ReactNode;
  label: string;
  onAdd?: () => void;
  addLabel?: string;
};

<CatHead icon={<Lightbulb />} label="Éclairages" />
<CatHead icon={<ChefHat />} label="Recettes"
         onAdd={addRecipe} addLabel="Ajouter une recette" />
```

---

## See also

- [panel.md](panel.md) — parent container
- [eq-row.md](eq-row.md) — sibling rows below a cat-head
