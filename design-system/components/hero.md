# Zone hero (`hero`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> The title block at the top of a zone view. Composed of two lines: the zone title and a state-synthesis lead.

---

## Anatomy

```
┌─────────────────────────────────────────────────────────┐
│                                                         │  ← padding-top 2.1rem
│  Séjour                                                 │  .hero__title (2.6rem, weight 700)
│                                                         │
│  1 lumière allumée  ·  tous les volets ouverts          │  .hero__lead (0.85rem, n-500)
│                                                         │
└─────────────────────────────────────────────────────────┘  ← padding-bottom 1.25rem
                                                              radial gradients in bg
```

The hero **does not** carry a breadcrumb (the topbar does that) or a mode badge (the Comportements panel does). It's intentionally minimal — the focus is on the zone name and a one-line synthesis of state.

---

## States

The hero has no interactive state. Its appearance is driven by data:

- `.hero__title` text changes per zone
- `.hero__lead` text is computed from the zone's aggregate state (e.g. "1 lumière allumée · tous les volets ouverts")

---

## Slots

| Slot           | Class             | Required              | Content                                    |
| -------------- | ----------------- | --------------------- | ------------------------------------------ |
| Title          | `.hero__title`    | yes                   | Zone name                                  |
| Lead           | `.hero__lead`     | optional              | State synthesis. Hide if no notable state. |
| Lead separator | `.hero__lead-sep` | between lead segments | small dot dot dot (·)                      |

---

## Code

```html
<div class="hero">
  <div class="hero__head">
    <div class="hero__main">
      <h1 class="hero__title">Séjour</h1>
      <div class="hero__lead">
        <span>1 lumière allumée</span>
        <span class="hero__lead-sep"></span>
        <span>tous les volets ouverts</span>
      </div>
    </div>
  </div>
</div>
```

```css
.hero {
  position: relative;
  padding: 2.1rem 1.5rem 1.25rem;
  background:
    radial-gradient(
      120% 80% at 0% 0%,
      color-mix(in srgb, var(--p-500) 6%, transparent),
      transparent 55%
    ),
    radial-gradient(
      80% 100% at 100% 0%,
      color-mix(in srgb, var(--a-500) 4%, transparent),
      transparent 60%
    );
}

.hero__head {
  margin-bottom: 1.4rem;
}
.hero__main {
  min-width: 0;
}
.hero__title {
  font-size: 2.6rem;
  font-weight: 700;
  margin: 0 0 0.15rem;
  color: var(--n-800);
  letter-spacing: -0.03em;
  line-height: 1;
}
.hero__lead {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.55rem;
  font-size: 0.85rem;
  color: var(--n-500);
  font-feature-settings: "tnum" 1;
}
.hero__lead b {
  color: var(--n-700);
  font-weight: 600;
}
.hero__lead-sep {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--n-300);
  flex: none;
}
```

---

## Lead content rules

The lead synthesizes state in **natural language**. Format: `N <item> <state>` per segment, joined by dot separators.

Examples per zone state:

- All quiet: `1 lumière allumée · tous les volets ouverts`
- Movement detected: `mouvement détecté il y a 39 min · 2 lumières allumées`
- Alert: `1 porte oubliée ouverte · tous les volets ouverts` (alert is more strongly highlighted in the strip)

**Avoid**:

- Generic counts like "12 équipements" (the user removed these — they're noise).
- Listing every state. Pick the 2–3 most meaningful for the moment.
- Tense markers like "actuellement" — implicit.

---

## Accessibility

| Concern         | Implementation                                                                           |
| --------------- | ---------------------------------------------------------------------------------------- |
| `<h1>` semantic | The zone title is the page H1. Wrap as `<h1>` in production.                             |
| `aria-live`     | The lead may update in real-time. Wrap as `<div aria-live="polite">` if data refreshes.  |
| Color contrast  | `--n-800` (`#18181B`) on the gradient backdrop (still effectively `--n-50`): 14:1 — AAA. |
| Decoration      | The radial gradients are decorative and do not carry meaning. No ARIA needed.            |

---

## Do / Don't

✅ **Do**: keep the title at 2.6rem on desktop. It's the page's anchor.
✅ **Do**: use the lead to surface non-obvious state ("calme depuis 39 min", "soleil dans 1h12"). Avoid restating data already in the strip.
✅ **Do**: keep the gradients subtle (4–6% color mix). They give identity without screaming.

❌ **Don't**: re-add a breadcrumb eyebrow above the title — the topbar already shows it.
❌ **Don't**: put a status badge ("Mode Lumière soir actif") next to the title. Mode info lives in the Comportements panel.
❌ **Don't**: stack more than 2–3 segments in the lead. If you need more, you're overloading the hero.

---

## React mapping (proposal)

```tsx
type HeroProps = {
  zoneName: string;
  leadSegments?: string[];
};

<Hero zoneName="Séjour" leadSegments={["1 lumière allumée", "tous les volets ouverts"]} />;
```

---

## See also

- [strip.md](strip.md) — Comes immediately below the hero, surfaces detailed state.
- [topbar.md](topbar.md) — Carries the breadcrumb the hero deliberately doesn't.
