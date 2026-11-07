# Modal (recipe edit)

> Centered overlay card used to edit a recipe's parameters. Contains the recipe's full configuration in one screen — including our value-add over production: per-mode overrides.

---

## Anatomy

```
        ┌─────────────────────────────────────────────────┐
        │ [icon] Lumière dimmable sur mouvement       [×] │  .modal__head (border-bottom)
        │        Recette · zone Séjour · pilotée par 1 mode │
        ├─────────────────────────────────────────────────┤
        │                                                 │  .modal__body (scrollable, gap 1.4rem)
        │ Lumières à contrôler*                           │   ┌ section
        │ Lumières dimmables à contrôler (doivent…)       │   │  .msec__label + msec__help
        │ ┌────────────────┐                              │   │
        │ │ ☑ Applique x 1 │                              │   │  .mcheck
        │ ├────────────────┤                              │   │
        │ │ ☑ Appliques x 2│                              │   │
        │ └────────────────┘                              │   └
        │                                                 │
        │ Paramètres                                      │   ┌ section
        │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐             │   │  .mfgrid (2-col)
        │ │Délai*│ │Lumin.│ │Seuil │ │Auto  │             │   │  .mfield each
        │ │10 min│ │ 254  │ │ 2300 │ │  —   │             │   │
        │ └──────┘ └──────┘ └──────┘ └──────┘             │   └
        │                                                 │
        │ Interrupteurs physiques                         │
        │ ┌────────────────┐                              │
        │ │ ☐ Switch …     │                              │
        │ └────────────────┘                              │
        │                                                 │
        │ Plages horaires                                 │   ┌ amber-bordered group
        │ ┌─Plage 1───────────────────────────────────┐  │   │  .mplage
        │ │ [Début 21:00] [Fin 08:00] [Lum 100]       │  │   │
        │ └────────────────────────────────────────────┘  │   └
        │ ┌+ Plage 2┐ ┌+ Plage 3┐                         │      .mplage__add
        │                                                 │
        │ Surcharges par mode  [amélioration UX]          │   ┌ amber border-left
        │ ● Lumière soir [Actif]   21:00→08:00 · 4 %  [M] │   │  .mover__row
        │ ○ Lumière jour            Désactivée le jour [M]│   │
        │ ○ Lumière nuit            Pas de surcharge  [+] │   └
        ├─────────────────────────────────────────────────┤
        │ Modifications non enregistrées   [Annuler][✓Enregistrer] │  .modal__foot
        └─────────────────────────────────────────────────┘
```

The modal lives inside a `.modal-stage` (a fake page with a dimmed/hatched backdrop in the mockup). In production, the stage would be a real overlay with `position: fixed; inset: 0; background: rgba(0,0,0,.4)`.

---

## Body sections (top to bottom)

1. **Lumières à contrôler** (`.mcheck`) — Checklist of eligible lights. Each item is a checkbox + name in a rounded card.
2. **Paramètres** (`.mfgrid`, 2 cols × 2 rows) — Délai (min), Luminosité (1-254), Seuil lux max, Extinction auto.
3. **Interrupteurs physiques** (`.mcheck`) — Optional checklist of physical switches that toggle the recipe manually.
4. **Options** — Single checkbox: "Inactif le jour".
5. **Plages horaires** (`.mplage`) — Amber-bordered group with Début / Fin / Luminosité. Followed by dashed `+ Plage 2` / `+ Plage 3` to add more.
6. **Surcharges par mode** (`.mover`, amber-bordered section) — **Our value-add**. List of modes with their per-mode override values + Modifier / Activer buttons. Marked with `amélioration UX` beta badge.

---

## States

| State                | Class                                                 | Effect                                                              |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Default              | `.modal`                                              | white card, multi-layer shadow, max-width 640 px, max-height 720 px |
| Section default      | `.msec`                                               | gap .55rem between label/help/content                               |
| **Enhanced section** | `.msec--enhance`                                      | adds amber border-left to mark "this isn't in production"           |
| Modified             | `.modal__foot-status::before` neutral grey dot        | "Modifications non enregistrées"                                    |
| Save state           | (production wires `disabled` on Save when no changes) | greyed out save button                                              |

---

## Form atom variants

| Atom               | Class                                | Used for                                       |
| ------------------ | ------------------------------------ | ---------------------------------------------- |
| Checklist item     | `.mcheck__item`                      | each binding (lights, switches)                |
| Field (compact)    | `.mfield`                            | a single labeled input                         |
| Field with suffix  | `.mfield__input` + `.mfield__suffix` | "10 min", "2300 lx"                            |
| Compact field grid | `.mfgrid`                            | 2-col responsive layout for primary parameters |
| Plage group        | `.mplage`                            | amber-bordered horizontal time range           |
| Mode override row  | `.mover__row`                        | one row per mode with its override value       |
| Action button      | `.mbtn` / `.mbtn--primary`           | footer Save / Cancel                           |

---

## Code

### Header

```html
<div class="modal__head">
  <div class="modal__head-icon">
    <svg>… ChefHat …</svg>
  </div>
  <div class="modal__head-titles">
    <div class="modal__head-title">Lumière dimmable sur mouvement</div>
    <div class="modal__head-sub">Recette · zone <b>Séjour</b> · pilotée par 1 mode</div>
  </div>
  <button class="modal__close" aria-label="Fermer">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  </button>
</div>
```

### Field with suffix

```html
<div class="mfield">
  <label class="mfield__lab">Délai<span class="msec__required">*</span></label>
  <div class="mfield__input">
    <input type="number" value="10" />
    <span class="mfield__suffix">min</span>
  </div>
  <span class="mfield__help">Sans mouvement avant extinction</span>
</div>
```

### Plage horaire group

```html
<div class="mplage">
  <div class="mplage__head">
    <span class="mplage__title">Plage 1</span>
    <button class="mplage__del" aria-label="Supprimer la plage">…</button>
  </div>
  <div class="mplage__grid">
    <div class="mfield"><label>Début</label><input type="time" value="21:00" /></div>
    <div class="mfield"><label>Fin</label><input type="time" value="08:00" /></div>
    <div class="mfield"><label>Luminosité</label><input type="number" value="100" /></div>
  </div>
</div>
<div class="mplage__add-row">
  <button class="mplage__add">+ Plage 2</button>
  <button class="mplage__add">+ Plage 3</button>
</div>
```

### Footer

```html
<div class="modal__foot">
  <span class="modal__foot-status">Modifications non enregistrées</span>
  <div class="modal__foot-actions">
    <button class="mbtn">Annuler</button>
    <button class="mbtn mbtn--primary"><svg>… check …</svg>Enregistrer</button>
  </div>
</div>
```

---

## Behavior

| Trigger                                         | Action                                    |
| ----------------------------------------------- | ----------------------------------------- |
| Click `.recipe__open` on a recipe row           | Modal opens                               |
| Click `.modal__close` (×)                       | Close modal. If unsaved changes → confirm |
| Click backdrop (`.modal-stage::before` in mock) | Close modal. If unsaved changes → confirm |
| Press `Escape`                                  | Close modal. If unsaved changes → confirm |
| Click `.mbtn` (Annuler)                         | Discard changes, close modal              |
| Click `.mbtn--primary` (Enregistrer)            | Save, close modal                         |

---

## Accessibility

| Concern               | Implementation                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Role                  | The `.modal` container must be `role="dialog" aria-modal="true"`.                                                                |
| Title                 | `.modal__head-title` should be the `aria-labelledby` target.                                                                     |
| Initial focus         | Production should focus the first interactive element (first checkbox or close button) on open.                                  |
| Escape                | Must close the modal.                                                                                                            |
| Focus trap            | While the modal is open, focus stays within. Production must wire a focus trap.                                                  |
| Tabular nums          | All numeric inputs use `font-feature-settings: "tnum" 1` so `2300` aligns with `10` if stacked.                                  |
| Color contrast        | Help text `--n-400` on `--n-0`: 4.6:1 — barely AA. Production should use `--n-500` for help text when accessibility is critical. |
| Required field marker | The `*` is a visual cue only. Production must also add `aria-required="true"`.                                                   |
| Section semantics     | Each `<section class="msec">` should have an `<h3>` (or `aria-label`) summarizing it.                                            |

---

## Do / Don't

✅ **Do**: keep all sections inside one scrollable body. Don't split into tabs — recipes are short enough to fit.
✅ **Do**: mark our "Surcharges par mode" section with the **amélioration UX** beta badge so users know it's not in production yet.
✅ **Do**: use the amber border-left on both `mplage` and `msec--enhance` — that's the visual signal "this is a time-related or mode-related concept" tied to the Sowel amber accent.

❌ **Don't**: make this an inline expand under the recipe row. Production does inline, but we chose modal for better focus on the form. Acknowledged divergence (documented in [README.md](../README.md) and the modal section intro).
❌ **Don't**: nest tabs or sub-modals. If config gets that complex, the recipe spec should be re-thought.
❌ **Don't**: hide the unsaved-changes status. The user must know they have unsaved work.

---

## React mapping (proposal)

```tsx
<RecipeEditModal
  recipe={recipe}
  modes={modes}
  open={isOpen}
  onClose={handleClose}
  onSave={handleSave}
  isDirty={isDirty} // controls Save button enable + close confirm
/>
```

Internally:

- `EquipmentCheckList` — slot for `lights`-type equipment binding
- `ParameterGrid` — 2-col grid of `Field`s
- `PlageGroup` — repeatable, sortable list of time ranges
- `ModeOverridesPanel` — the value-add section

---

## See also

- [components/recipe-row.md](recipe-row.md) — Click target that opens this modal.
- [components/chip-state.md](chip-state.md) — "Actif" badge inside the mode overrides.
