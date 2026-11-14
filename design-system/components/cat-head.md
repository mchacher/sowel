# Sub-category header (`cat-head`)

> The thin band that visually groups rows of the same kind inside a [panel](panel.md). Examples: "Éclairages" / "Ouvrants" / "Capteurs" inside Équipements, "Modes" / "Recettes" inside Comportements.

---

## Anatomy

```
┌─────────────────────────────────────────────────────┐
│ [icon] ÉCLAIRAGES                            [+]    │   .cat-head (36 px)
└─────────────────────────────────────────────────────┘
        ↑                                        ↑
        icon: 14×14 muted, or on a 26 px family square                         optional add button
```

**Fixed height**: 36 px. Critical for cross-panel row alignment (Éclairages on the left lines up with Modes on the right).

---

## Variants

**Family tone (spec 208).** A section of the Équipements panel that is an equipment family (Éclairages, Ouvrants, Climat, Eau, Énergie, Capteurs) titles itself in the family ink, and its icon sits on a 26 px square of the family pale with the 6 px control radius (`SliceHeader` `family` prop, `ui/src/components/home/Panel.tsx`; tokens in [tokens.md §1.5](../tokens.md)). A neutral section (Multimédia, Électroménager, Prises, Commandes, Afficheurs) and the Comportements slices (Modes, Recettes) keep the text-colour title and the bare icon.

Two optional elements:

| Element                            | When                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.cat-head__add` (+ button)        | On Modes and Recettes sub-cats (Comportements panel). Never on Équipement sub-cats (the + lives on the panel head).                          |
| `.cat-head__count` (numeric badge) | **Hidden** by CSS — the user explicitly removed count badges. The class is preserved for legacy compat but `display: none` via `tokens.css`. |

---

## States

| State          | Effect                                                       |
| -------------- | ------------------------------------------------------------ |
| Default        | bg `--n-25`, text `--n-600`, sentence case, 13 px semibold   |
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
  font-size: var(--fs-small);
  color: var(--n-600);
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
  border: 1px solid var(--line-2);
  border-radius: var(--r-sm);
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

| Section (spec 208) | Icon (Lucide)                                        |
| ------------------ | ---------------------------------------------------- |
| Éclairages         | `Lightbulb`                                          |
| Ouvrants           | rect+lines (custom, matches production ShutterIcons) |
| Climat             | `Thermometer`                                        |
| Eau                | `Droplet`                                            |
| Énergie            | `Zap`                                                |
| Capteurs           | `Gauge`                                              |
| Multimédia         | `Tv`                                                 |
| Électroménager     | `WashingMachine`                                     |
| Prises             | `ToggleRight`                                        |
| Commandes          | `CircleDot`                                          |
| Afficheurs         | `Monitor`                                            |
| Autres             | `Box` (a type this UI does not know yet)             |
| Modes              | `Layers`                                             |
| Recettes           | `ChefHat`                                            |

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
✅ **Do**: colour the title and the icon square of an equipment family, and nothing else of the header (spec 208). The header band itself stays neutral: a tinted band was mocked up (board W, « A3 / A4 ») and not retained.
✅ **Do**: add the + button only where adding is contextually sensible (Modes, Recettes — not Capteurs or Météo where equipment is bound to a device).

❌ **Don't**: add a family-coloured stripe, border or background band to cat-heads; the title and the icon square carry the family.
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
