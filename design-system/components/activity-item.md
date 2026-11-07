# Activity item (`activity__item`)

> A single entry in the Activity feed (right column on desktop, scrollable section on mobile). Each entry is a timestamped, colored event with a short description.

---

## Anatomy

```
┌──────────────────────────────────────────────────────┐
│ 22:41 │ [icon] Appliques x2 → 4 %    par Motion Light│   .activity__item
│       │       (event category dot inside icon)        │
└──────────────────────────────────────────────────────┘
   .activity__item-time   .activity__item-icon   .activity__item-text + .by
```

---

## Categories

Each item has a category. The category is encoded by the **icon background color**:

| Category         | Icon class                     | Bg / Color                   | Used for                               |
| ---------------- | ------------------------------ | ---------------------------- | -------------------------------------- |
| Recipe action    | `.activity__item-icon--recipe` | `--p-50` / `--p-500`         | "Motion Light a réglé Appliques à 4 %" |
| Mode change      | `.activity__item-icon--mode`   | `--green-50` / `--green-700` | "Mode Lumière soir activé"             |
| Motion event     | `.activity__item-icon--motion` | `--info-50` / `--info-500`   | "Mouvement détecté sur PIR_00"         |
| Neutral / system | (no modifier)                  | `--n-50` / `--n-500`         | "Coucher du soleil · phase Nuit"       |

---

## Groups

Items are visually grouped by **time window** using a `.activity__group` separator:

```html
<div class="activity__group">22:00 → maintenant</div>
<div class="activity__item">…</div>
<div class="activity__item">…</div>

<div class="activity__group">21:00</div>
<div class="activity__item">…</div>
```

The group label is a small sentence-case caption. It compresses the time noise (many items at the same minute) and lets the eye scan by epoch.

---

## Code

### Recipe activity item

```html
<div class="activity__item">
  <div class="activity__item-icon activity__item-icon--recipe">
    <svg>… ChefHat …</svg>
  </div>
  <div class="activity__item-text">
    <b>Appliques x2</b> → 4 %
    <span class="by">par Motion Light</span>
  </div>
  <span class="activity__item-time">22:41</span>
</div>
```

### Motion event

```html
<div class="activity__item">
  <div class="activity__item-icon activity__item-icon--motion">
    <svg>… PersonStanding …</svg>
  </div>
  <div class="activity__item-text">Mouvement détecté sur <b>PIR_00</b></div>
  <span class="activity__item-time">22:40</span>
</div>
```

### Mode change

```html
<div class="activity__item">
  <div class="activity__item-icon activity__item-icon--mode">
    <svg>… Layers …</svg>
  </div>
  <div class="activity__item-text">
    Mode <b>Lumière soir</b> activé <span class="by">par le calendrier</span>
  </div>
  <span class="activity__item-time">21:00</span>
</div>
```

### CSS

```css
.activity__group {
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--n-400);
  padding: 0.5rem 1.1rem 0.25rem;
}

.activity__item {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: 0.65rem;
  align-items: center;
  padding: 0.55rem 1.1rem;
  border-top: 1px solid var(--line);
}
.activity__item:first-of-type {
  border-top: none;
}

.activity__item-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--r-sm);
  background: var(--n-50);
  color: var(--n-500);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.activity__item-icon svg {
  width: 12px;
  height: 12px;
}
.activity__item-icon--recipe {
  background: var(--p-50);
  color: var(--p-500);
}
.activity__item-icon--mode {
  background: var(--green-50);
  color: var(--green-700);
}
.activity__item-icon--motion {
  background: var(--info-50);
  color: var(--info-500);
}

.activity__item-text {
  font-size: var(--fs-caption);
  color: var(--n-600);
  line-height: 1.45;
}
.activity__item-text b {
  color: var(--n-800);
  font-weight: 600;
}
.activity__item-text .by {
  color: var(--n-400);
  font-size: var(--fs-caption);
}

.activity__item-time {
  font-size: var(--fs-caption);
  color: var(--n-400);
  font-feature-settings: "tnum" 1;
  flex-shrink: 0;
}
```

---

## Live updates

The Activity panel is **live** — new items appear at the top via WebSocket. The panel head has a `● live` indicator (green pill) using the panel\_\_count escape hatch:

```html
<span class="panel__count" style="background:var(--green-50);color:var(--green-700)">● live</span>
```

The dot is a static unicode `●` — no animation needed (the connection indicator's `connPing` is the global "alive" cue).

---

## Mobile variant (`.mob__act`)

Identical structure, slightly tighter:

```css
.mob__act {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.55rem 0.85rem;
  border-top: 1px solid var(--line);
}
.mob__act-time {
  font-size: var(--fs-micro);
  min-width: 38px;
  color: var(--n-400);
  padding-top: 1px;
}
.mob__act-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-top: 0.45rem;
}
.mob__act-dot--mode {
  background: var(--p-500);
}
.mob__act-dot--light {
  background: var(--a-500);
}
.mob__act-dot--motion {
  background: var(--sensor-500);
}
.mob__act-dot--shutter {
  background: var(--shutter-500);
}
.mob__act-text {
  font-size: var(--fs-caption);
  color: var(--n-700);
  line-height: 1.4;
}
```

Mobile uses a **colored dot** instead of a 24×24 icon (saves space) — the category is still encoded by color.

---

## Accessibility

| Concern         | Implementation                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List role       | Wrap the panel body as `<ul role="log" aria-live="polite" aria-relevant="additions">` so new items are announced.                                                |
| Each item       | `<li>` — no further role needed.                                                                                                                                 |
| Time            | The `<time datetime="2026-05-13T22:41">22:41</time>` element for semantic time.                                                                                  |
| Color cue alone | The icon color encodes category but **text always describes the event**. A green icon with "Mode Lumière soir activé" is fine. A green icon with no text is not. |
| Color contrast  | All variants (recipe / mode / motion / neutral) pass AA on white.                                                                                                |
| Scroll back     | The Activity panel scrolls. Production must wire keyboard scroll (arrow keys, Page Up/Down) for accessibility.                                                   |

---

## Do / Don't

✅ **Do**: limit items per group to ~6–10. If more, scroll within the panel.
✅ **Do**: keep timestamps in `HH:MM` (not seconds). Activity is glanceable, not forensic.
✅ **Do**: bold the equipment / recipe / mode name in the text. Helps scanning.

❌ **Don't**: add an action button per item ("Annuler", "Détails"). Activity is a log, not a workflow.
❌ **Don't**: re-color the entire item by category. The icon is the only colored element; the text stays neutral.
❌ **Don't**: animate item entries (slide-in, fade-in). Too noisy if events arrive frequently. The reduced-motion respect rule applies.

---

## React mapping (proposal)

```tsx
type ActivityEvent = {
  id: string;
  timestamp: Date;
  category: "recipe" | "mode" | "motion" | "system";
  text: ReactNode; // JSX, includes <b> for emphasis
  by?: string; // "par Motion Light", "manuellement"
};

<ActivityFeed events={events}>
  {events.map((e) => (
    <ActivityItem key={e.id} {...e} />
  ))}
</ActivityFeed>;
```

The component groups items by time window internally.

---

## See also

- [panel.md](panel.md) — Activity is hosted in a panel
- [motion.md](../motion.md) — No animation here, but reduced-motion is the broader policy
