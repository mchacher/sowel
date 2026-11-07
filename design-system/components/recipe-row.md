# Recipe row (`recipe`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> A row inside the Comportements panel's Recettes sub-category. Clickable to open the recipe edit modal, with an inline toggle and three small action buttons (logs, duplicate, delete).

---

## Anatomy

```
┌─────────┬──────────────────────────────────┬──────────┐
│         │ Lumière dimmable sur mouvement   │ [toggle] │   row 1
│ [icon]  ├──────────────────────────────────┤          │
│ 32×32   │ [📜] [📋] [🗑]                   │          │   row 2
│         │ 22×20 each                       │          │
└─────────┴──────────────────────────────────┴──────────┘
        ↑                                        ↑
        Grid: 32px 1fr auto, row-gap 0, min-height 52 px
        Icon spans both rows (grid-row: 1 / span 2)
```

The row is the only pattern in the design system with **two visible content rows in one grid cell**. The icon is rendered once but spans both rows. Row 1 holds the recipe name + toggle. Row 2 holds the three action buttons inline.

---

## Variants

There are no variants. The only state change is the toggle on/off via `.recipe__toggle--on`.

---

## States

| State                    | Class                            | Effect                                    |
| ------------------------ | -------------------------------- | ----------------------------------------- |
| Default                  | `.recipe`                        | white bg, 1 px line top border            |
| Hover (open zone)        | `.recipe__open:hover`            | name color shifts to primary blue         |
| Focused (keyboard)       | `.recipe__open:focus-visible`    | 2 px primary outline around the name      |
| Toggle on                | `.recipe__toggle--on`            | track turns green-500, thumb slides right |
| Action hover (logs)      | `.recipe__action:hover`          | neutral grey bg + dark text               |
| Action hover (duplicate) | `.recipe__action--primary:hover` | primary tint bg + primary text            |
| Action hover (delete)    | `.recipe__action--danger:hover`  | red tint bg + red text                    |

---

## Slots

| Position            | Class              | Required | Content                                    |
| ------------------- | ------------------ | -------- | ------------------------------------------ |
| Icon (spans 2 rows) | `.recipe__icon`    | yes      | 32×32 with ChefHat or recipe-specific icon |
| Row 1, col 2        | `.recipe__open`    | yes      | `<button>` containing `.recipe__name`      |
| Row 1, col 3        | `.recipe__toggle`  | yes      | Toggle switch (enable/disable recipe)      |
| Row 2, col 2–3      | `.recipe__actions` | yes      | Three `.recipe__action` buttons            |

---

## Code

### Full row

```html
<div class="recipe">
  <div class="recipe__icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M17 21v-5.35c0-.46.32-.84.73-1.04a4 4 0 0 0-2.13-7.59 5 5 0 0 0-9.2 0
               a4 4 0 0 0-2.13 7.59c.41.2.73.58.73 1.04V21M6 17h12"
      />
    </svg>
  </div>
  <button class="recipe__open" title="Voir et éditer la recette">
    <div class="recipe__name">Lumière dimmable sur mouvement</div>
  </button>
  <div
    class="recipe__toggle recipe__toggle--on"
    role="switch"
    aria-checked="true"
    tabindex="0"
  ></div>
  <div class="recipe__actions">
    <button class="recipe__action" title="Voir les logs" aria-label="Voir les logs">
      <svg>… ScrollText …</svg>
    </button>
    <button
      class="recipe__action recipe__action--primary"
      title="Dupliquer la recette"
      aria-label="Dupliquer"
    >
      <svg>… Copy …</svg>
    </button>
    <button
      class="recipe__action recipe__action--danger"
      title="Supprimer la recette"
      aria-label="Supprimer"
    >
      <svg>… Trash2 …</svg>
    </button>
  </div>
</div>
```

### CSS (key rules)

```css
.recipe {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  column-gap: 0.85rem;
  row-gap: 0;
  align-items: center;
  padding: 0.35rem 1.1rem;
  min-height: 52px;
  box-sizing: border-box;
  border-top: 1px solid var(--line);
}

.recipe__icon {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  background: var(--p-50);
  color: var(--p-500);
  display: flex;
  align-items: center;
  justify-content: center;
  grid-row: 1 / span 2;
  align-self: center;
}
.recipe__icon svg {
  width: 15px;
  height: 15px;
}

.recipe__open {
  grid-row: 1;
  grid-column: 2;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  min-width: 0;
}
.recipe__open:hover .recipe__name {
  color: var(--p-500);
}
.recipe__open:focus-visible {
  outline: 2px solid var(--p-500);
  outline-offset: 2px;
  border-radius: 2px;
}

.recipe__name {
  line-height: 1.2;
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--n-800);
}

.recipe__toggle {
  grid-row: 1;
  grid-column: 3;
}

.recipe__actions {
  grid-row: 2;
  grid-column: 2 / 4;
  display: flex;
  gap: 0.15rem;
}
.recipe__action {
  width: 22px;
  height: 20px;
  background: transparent;
  border: none;
  color: var(--n-400);
  cursor: pointer;
  border-radius: var(--r-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition:
    background-color 140ms,
    color 140ms;
}
.recipe__action svg {
  width: 12px;
  height: 12px;
}
.recipe__action:hover {
  background: var(--n-50);
  color: var(--n-700);
}
.recipe__action--primary:hover {
  background: var(--p-50);
  color: var(--p-500);
}
.recipe__action--danger:hover {
  background: var(--red-50);
  color: var(--red-500);
}
```

---

## Why the row is a `<div>`, not a `<button>`

The whole row CANNOT be a `<button>` because:

- Nested buttons (toggle, actions) are invalid HTML
- The toggle's click needs to NOT trigger the row's onClick (event.stopPropagation)
- Accessible focus order needs each interactive element to be its own focusable

Instead, only the **`.recipe__open` zone** (icon-adjacent name area) is a `<button>`. It's the click target that opens the modal. The toggle and the three actions are independent buttons.

In production this maps to a wrapping container that does NOT capture clicks itself.

---

## Accessibility

| Concern | Implementation |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Open recipe (primary action) | `<button class="recipe__open" title="…">` — keyboard accessible, focusable, focus-visible style |
| Toggle | `role="switch" aria-checked="true                                                                                                                                                                                                                      | false"`+`tabindex="0"`— production must implement keyboard`Space` to toggle |
| Action buttons | Each has `aria-label` distinct from the title (icon-only buttons need both for screen readers) |
| Visual order vs DOM order | DOM order is icon → open → toggle → actions. Visual row 2 (actions) appears AFTER row 1 visually but is fine because grid placement doesn't change DOM. |
| Color contrast | `.recipe__action--danger` red-500 on red-50 hover: AAA. `.recipe__action--primary` blue-500 on blue-50: AAA. |
| Touch targets | Action buttons are 22 × 20 px. Below Apple HIG 44 × 44 — acceptable in a dense list context, but on mobile we **hide row 2** entirely (`.recipe__actions { display: none }` on mobile in production). Mobile users access these actions via the modal. |
| Focus indicator | `.recipe__open:focus-visible` shows a 2 px primary outline. Action buttons rely on default browser focus ring (production may override). |

---

## Do / Don't

✅ **Do**: keep the three actions in the order **logs → duplicate → delete** (most-used to most-destructive).
✅ **Do**: assign hover colors by intent: logs = neutral, duplicate = primary, delete = red.
✅ **Do**: hide the action row on mobile and let the modal expose them.
✅ **Do**: keep `padding: .35rem 1.1rem` (smaller than eq-row's `.55rem`) — the row needs less padding because it has 2 rows of content.

❌ **Don't**: add a 4th action button. The trio (logs / duplicate / delete) is the production standard and overflows poorly.
❌ **Don't**: show a 2nd row of params under the name ("Applique x1, x2 · 10m · …"). The user explicitly rejected this — params live in the modal.
❌ **Don't**: change the toggle to a button or checkbox. The pill switch is the production pattern across the app.

---

## React mapping (proposal)

```tsx
type RecipeRowProps = {
  recipe: RecipeInstance;
  enabled: boolean;
  onOpenEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onShowLogs: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};
```

The container is a `<div>`. Each action callback is wired to its respective button.

---

## See also

- [mode-row.md](mode-row.md) — Same panel, different shape.
- [toggle.md](toggle.md) — Pill toggle atom.
- [modal.md](modal.md) — Opened when `.recipe__open` is clicked.
