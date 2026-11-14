# Panel

> The top-level container of a section in the zone view. Three panels exist on a zone page: **Équipements**, **Comportements**, **Activité**.

---

## Anatomy

```
┌─────────────────────────────────────────────────────┐
│ ÉQUIPEMENTS  dans cette zone              [+]       │  ← .panel__head (44 px)
├─────────────────────────────────────────────────────┤
│ 💡 ÉCLAIRAGES                                       │  ← .cat-head (36 px)
├─────────────────────────────────────────────────────┤
│ [icon] Applique x 1    [slider]   0 %   [power]    │  ← .eq (52 px)
│ [icon] Appliques x 2   [slider]   4 %   [power]    │
└─────────────────────────────────────────────────────┘
```

**Fixed heights**: `panel__head = 44 px`, `cat-head = 36 px`, row = `52 px`. These three numbers are the spine of the layout and must not drift. They guarantee row-to-row alignment across the two-column grid (Équipements + Comportements).

---

## Anatomy parts

| Part                | Class                                                      | Required                     |
| ------------------- | ---------------------------------------------------------- | ---------------------------- |
| Wrapper             | `.panel`                                                   | yes                          |
| Header              | `.panel__head`                                             | yes                          |
| Title               | `.panel__title`                                            | yes (sentence case, 16 px)   |
| Sub-text            | `.panel__sub`                                              | optional ("dans cette zone") |
| Action              | `.panel__add`                                              | optional (`+` icon to add)   |
| Sub-category header | `.cat-head`                                                | one per group                |
| Body rows           | one of `.eq` / `.mode-row` / `.recipe` / `.activity__item` | n+                           |

---

## States

| State                                | Class                                      | Effect                                  |
| ------------------------------------ | ------------------------------------------ | --------------------------------------- |
| Default                              | `.panel`                                   | white bg, no border, card shadow, 10 px |
| Live indicator (Activity panel only) | `.panel__count` with inline style override | shows `● live` green badge in header    |

The panel itself has no hover/active state. Interactivity lives on its rows.

---

## Variants

There are no panel variants. All three panels (Équipements, Comportements, Activité) use the same `.panel` class. Their content differs (row types, sub-categories), not their chrome.

The **panel\_\_head** has one optional element: a `+` button (`.panel__add`) for adding equipment. The Comportements and Activité panels do not have this — the `+` for adding modes or recipes lives on the **cat-head** of those sub-categories instead.

---

## Code

### HTML

```html
<div class="panel">
  <div class="panel__head">
    <span class="panel__title">Équipements</span>
    <span class="panel__sub">dans cette zone</span>
    <button class="panel__add" aria-label="Ajouter un équipement">
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

  <!-- Sub-categories and rows go here -->
  <div class="cat-head">
    <svg class="cat-head-icon">…</svg>
    Éclairages
  </div>
  <div class="eq">…</div>
  <div class="eq">…</div>
</div>
```

### CSS (extract)

```css
.panel {
  background: var(--n-0);
  border-radius: var(--r-md); /* 10 px, the card radius (spec 196) */
  box-shadow: var(--sh-card); /* no border: a card */
  overflow: hidden;
}

.panel__head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 1.1rem;
  min-height: 44px;
  box-sizing: border-box;
  background: var(--p-50);
  border-bottom: 1px solid var(--p-100);
}

.panel__title {
  font-size: var(--fs-lead);
  font-weight: 600;
  color: var(--n-700);
}

.panel__sub {
  font-size: var(--fs-caption);
  font-weight: 500;
  margin-left: 0.35rem;
  color: color-mix(in srgb, var(--p-500) 65%, transparent);
}

.panel__add {
  margin-left: auto;
  width: 26px;
  height: 26px;
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--r-sm);
  color: var(--p-500);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.panel__add:hover {
  background: var(--n-0);
  border-color: var(--p-500);
}
.panel__add svg {
  width: 13px;
  height: 13px;
}
```

---

## Accessibility

| Concern        | Implementation                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heading role   | `.panel__title` should be wrapped in `<h2>` when the panel is a true page section. The mock uses `<span>` for visual demo. Production must elevate to `<h2>` or `role="heading" aria-level="2"`.                |
| `+` button     | Must have `aria-label="Ajouter un équipement"` (or scope-specific). Icon alone is not accessible.                                                                                                               |
| Color contrast | Primary `#1A4F6E` on `#EEF5F8` background: **WCAG AAA** (10.3:1).                                                                                                                                               |
| Touch target   | `.panel__add` is 26 × 26 px which is below Apple HIG 44 × 44 recommendation. **Action: bump to 28 × 28 px in production** and ensure the surrounding panel head padding gives at least 36 px of clickable area. |

---

## Do / Don't

✅ **Do**: use `panel__sub` for contextual scope ("dans cette zone"), not for marketing copy.
✅ **Do**: keep panel head height fixed at 44 px regardless of whether a `+` button is present.
✅ **Do**: rely on `cat-head` for grouping inside the panel rather than nesting another `.panel`.

❌ **Don't**: drop the panel head if there's nothing to put in it — the head is the only visual anchor that signals "this is a section".
❌ **Don't**: put a colored accent border on the panel itself. Accents go on rows or sub-cats.
❌ **Don't**: tint the panel head by category (e.g. amber for Équipements). The user explicitly rejected this — sub-cats use neutral (an equipment family's title and icon square excepted, spec 208), parent panels use primary.

---

## React mapping (proposal)

```tsx
type PanelProps = {
  title: string;
  sub?: string;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
};

<Panel
  title="Équipements"
  sub="dans cette zone"
  onAdd={() => openAddEquipmentModal()}
  addLabel="Ajouter un équipement"
>
  <CatHead label="Éclairages" />
  <EqRow … />
  <EqRow … />
</Panel>
```

The `+` button only renders when `onAdd` is provided.

---

## See also

- [cat-head.md](cat-head.md) — Sub-category header that lives inside a panel.
- [eq-row.md](eq-row.md), [mode-row.md](mode-row.md), [recipe-row.md](recipe-row.md) — Row patterns used in a panel body.
