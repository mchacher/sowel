# Zone aggregation strip (`strip`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> Single-line, content-width pill row that surfaces all aggregated state of a zone. Modeled on production's `ZoneAggregationPills` component, with our group-divider refinement.

---

## Anatomy

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [🌡 21,4°C] | [💧 48%] | [☀ 334 lx] || [🚶 Calme · 39min] | [💡 1/3] | [⊟ 3/3 · Ouvert] || [⚠ 1 ouverte] │
└──────────────────────────────────────────────────────────────────────────┘
  group 1: sensors          group 2: counters / states              group 3: alerts
  ──────────────            ─────────────────────                   ──────────
```

Three soft groups separated by a slightly heavier divider (`--line-2`):

1. **Sensors** — temperature, humidity, lux, etc.
2. **Counters / state** — motion (Calme / Détecté), lights 1/3, shutters 3/3 · Ouvert
3. **Alerts** (optional) — open doors, smoke, leak, water flow

The strip is **always one line**. If it overflows, it scrolls horizontally (`overflow-x: auto`).

---

## Variants

There are no visual variants of the strip itself. The variations come from the **pills** inside.

| Pill state                   | Class                                     |
| ---------------------------- | ----------------------------------------- |
| Default                      | `.strip__pill`                            |
| Active (light on)            | `.strip__pill--active` (amber accents)    |
| Calm (motion sensor at rest) | `.strip__pill--calm` (green accents)      |
| Alert                        | `.strip__pill--alert` (red bg, pulse dot) |

---

## Conditional rendering rule

A pill renders **only if its sensor or data exists** for the zone. A bathroom without a lux sensor never shows a lux pill. Empty strip cells were the most criticized issue in earlier iterations — the strip must be honest.

---

## Code

### Container

```html
<div class="strip">
  <!-- Sensors group -->
  <div class="strip__pill" title="Température · 3 capteurs">
    <svg class="strip__pill-icon" style="--c:var(--info-500)">…thermometer…</svg>
    <span class="strip__pill-val">21,4<span class="u">°C</span></span>
    <svg class="strip__pill-spark">…sparkline…</svg>
  </div>
  <span class="strip__div"></span>
  <div class="strip__pill" title="Humidité moyenne">…</div>
  <span class="strip__div"></span>
  <div class="strip__pill" title="Luminosité · capteur Séjour">…</div>

  <!-- Group break -->
  <span class="strip__div strip__div--group"></span>

  <!-- Counters group -->
  <div class="strip__pill strip__pill--calm" title="Mouvement · calme depuis 39 min">…</div>
  <span class="strip__div"></span>
  <div class="strip__pill strip__pill--active" title="1 lumière allumée sur 3">…</div>
  <span class="strip__div"></span>
  <div class="strip__pill" title="3 volets · tous ouverts">…</div>

  <!-- Alerts group (only if any) -->
  <span class="strip__div strip__div--group"></span>
  <div class="strip__pill strip__pill--alert" title="Porte-fenêtre ouverte">…</div>
</div>
```

### Layout CSS

```css
.strip {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  background: var(--n-0);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 0.35rem 0.4rem;
  margin-bottom: 0.65rem;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--n-200) transparent;
}
.strip::-webkit-scrollbar {
  height: 6px;
}
.strip::-webkit-scrollbar-thumb {
  background: var(--n-200);
  border-radius: 3px;
}

.strip__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.65rem;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--n-700);
  border-radius: var(--r-sm);
  white-space: nowrap;
  font-feature-settings: "tnum" 1;
  transition: background-color 160ms;
}
.strip__pill:hover {
  background: var(--n-25);
}

.strip__pill-icon {
  width: 14px;
  height: 14px;
  color: var(--c, var(--n-400));
  flex: none;
}
.strip__pill-val {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--n-800);
  letter-spacing: -0.005em;
}
.strip__pill-val .u {
  font-size: 0.78em;
  color: var(--n-400);
  margin-left: 1px;
  font-weight: 500;
}
.strip__pill-meta {
  font-size: 0.76rem;
  color: var(--n-500);
}
.strip__pill-spark {
  width: 48px;
  height: 16px;
  margin-left: 0.15rem;
  flex: none;
  opacity: 0.8;
}

.strip__div {
  width: 1px;
  height: 18px;
  background: var(--n-200);
  margin: 0 0.15rem;
  flex: none;
}
.strip__div--group {
  margin: 0 0.35rem;
  background: var(--line-2);
  height: 22px;
  flex: none;
}
```

### Pill state variants

```css
.strip__pill--active .strip__pill-icon {
  color: var(--a-500);
}
.strip__pill--active .strip__pill-val {
  color: var(--a-600);
}

.strip__pill--calm .strip__pill-icon {
  color: var(--green-500);
}
.strip__pill--calm .strip__pill-val {
  color: var(--green-700);
  font-family: var(--font-body);
  font-weight: 600;
}

.strip__pill--alert {
  background: var(--red-50);
  color: var(--red-500);
  font-weight: 600;
}
.strip__pill--alert .strip__pill-icon {
  color: var(--red-500);
}
.strip__pill--alert .strip__pill-val {
  color: var(--red-500);
  font-family: var(--font-body);
  font-weight: 700;
}
.strip__pill--alert::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--red-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--red-500) 25%, transparent);
  animation: pulseAlert 1.6s ease-in-out infinite;
  margin-right: -0.1rem;
}
```

---

## Mobile variant

On mobile the strip becomes a horizontal scroll container (already a scroll container on desktop; on mobile the scrollbar is hidden):

```css
.mob__strip {
  display: flex;
  align-items: center;
  background: var(--n-0);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 0.3rem 0.35rem;
  margin-bottom: 0.85rem;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.mob__strip::-webkit-scrollbar {
  display: none;
}
```

Pill sizes are slightly smaller on mobile (`mob__pill` with .76rem font and 13px icons).

---

## Accessibility

| Concern           | Implementation                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Pill role         | Pills are read-only — `<div>` is fine. If a pill becomes interactive (click → detail), promote to `<button>`.                             |
| Alert pill        | `role="alert"` if the underlying state is critical (smoke, leak). `aria-live="polite"` otherwise.                                         |
| `title` attribute | Each pill has a `title` for tooltips. Production must also surface this as visible text on mobile (no hover available).                   |
| Color contrast    | All pill text on white: AAA. Alert pill `--red-500` on `--red-50`: 4.5:1 (borderline AA — production may bump to `--red-700` for safety). |
| Reduced motion    | The alert pulse honors `prefers-reduced-motion` and stops looping.                                                                        |

---

## Do / Don't

✅ **Do**: render pills conditionally based on data presence.
✅ **Do**: use the three-group structure (sensors / counters / alerts) — it's the cognitive sort order.
✅ **Do**: keep the strip on one line. Scroll if needed; never wrap.

❌ **Don't**: add a fourth group. If you need a fourth bucket of state, the strip is full and the data should move into the hero lead or a dedicated panel.
❌ **Don't**: make the strip 2 lines tall to fit more pills. The strip is a glance — it must fit one line.
❌ **Don't**: use the active (amber) variant on anything but lights. Reserved for "live light is on".

---

## React mapping (proposal)

```tsx
<Strip>
  {data.temperature !== null && <Pill icon={<Thermometer/>} value={`${data.temperature}°C`} sparkData={…}/>}
  {data.humidity !== null && <Pill icon={<Droplets/>} value={`${data.humidity}%`}/>}
  {data.luminosity !== null && <Pill icon={<Sun/>} value={`${data.luminosity} lx`}/>}
  <GroupDivider />
  {data.motionSensors > 0 && <Pill variant="calm" icon={<PersonStanding/>} value={motionLabel}/>}
  {data.lightsTotal > 0 && <Pill variant="active" icon={<Lightbulb/>} value={`${data.lightsOn}/${data.lightsTotal}`}/>}
  {data.shuttersTotal > 0 && <Pill icon={<ShutterIcon/>} value={`${data.shuttersOpen}/${data.shuttersTotal}`}/>}
  {hasAlerts && <GroupDivider />}
  {data.openDoors > 0 && <Pill variant="alert" icon={<DoorOpen/>} value={`${data.openDoors} ouverte`}/>}
</Strip>
```

---

## See also

- [pill.md](pill.md) — Pill atom documentation
- [hero.md](hero.md) — Lives above the strip
- Production reference: `ui/src/components/home/ZoneAggregationPills.tsx`
