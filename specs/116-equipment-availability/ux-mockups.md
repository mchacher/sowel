# UX mockups — Equipment availability propagation

> **For the visual reference, open [`ux-mockups.html`](ux-mockups.html) in a browser.** That file reproduces the actual production components (CompactEquipmentCard `.eq` grid pattern, EnergyDataPanel 2x2 grid, LiveEnergyPage flow diagram, WidgetCard 240px height) using the real `design-system/tokens.css` colors. This `.md` is the textual contract: shared components, copy, and accessibility.

This file complements [spec.md](spec.md) FR8 to FR11 and [architecture.md](architecture.md). It defines the visual language, the shared components, and the per-screen layout for the stale / degraded / offline indicators.

All mockups are aligned on the Sowel design system defined in [`CLAUDE.md`](../../CLAUDE.md) and `design-system/tokens.css`. Reuses existing Tailwind semantic colors (`bg-error/10 text-error`, `bg-warning/10 text-warning`) and the `HeaderPill` / `ConnectionStatus` / `IntegrationRow` patterns already in the codebase. No new color tokens.

---

## 1. Design tokens used

| Purpose              | Token / class                                                    | Notes                                                  |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| Offline (red)        | `bg-error/10 text-error`, `border-error/20`                      | Hard failure: device unreachable                       |
| Degraded (ambre)     | `bg-warning/10 text-warning`, `border-warning/20`                | Partial failure: ≥1 device offline OR ≥1 binding stale |
| Online (default)     | No badge                                                         | Silence is success                                     |
| Stale value (inline) | `text-text-tertiary`, value italic                               | Greys out the number itself                            |
| Last-seen caption    | `text-[11px] text-text-tertiary`                                 | Subtle, never primary                                  |
| Pill radius          | `rounded-full`                                                   | Matches `HeaderPill`, `ConnectionStatus`               |
| Card radius          | `rounded-[10px]`                                                 | Matches existing cards (CLAUDE.md spacing rules)       |
| Pill padding (sm)    | `px-1.5 py-0.5`                                                  | Compact card variant                                   |
| Pill padding (md)    | `px-2.5 py-1`                                                    | Detail card variant                                    |
| Icon                 | Lucide, `strokeWidth={1.5}`, `size={14}` (sm) / `size={16}` (md) | Project convention                                     |
| Font                 | Inter for labels, JetBrains Mono for timestamps                  | Per design system                                      |
| Font size (badge)    | `text-[10px]` (sm) / `text-[12px]` (md)                          | Aligns with sidebar badge / HeaderPill                 |
| Font weight (badge)  | `font-medium`                                                    | Matches sidebar offline-count badge                    |

Icons:

- Degraded → `AlertTriangle` (Lucide)
- Offline → `WifiOff` (Lucide)
- Stale value indicator → `Clock` (Lucide) — only used inline, never as a badge by itself

---

## 2. Shared component: `<EquipmentStatusBadge>`

Single component, two size variants, three states. Hides itself when `status === "online"`.

### Anatomy

```
┌─────────────────────────────────┐
│  ⚠ Dégradé                     │   degraded — sm variant
└─────────────────────────────────┘
   ↑     ↑
   icon  i18n label (equipment.status.degraded)
   14px  10px font-medium
   stroke 1.5

┌─────────────────────────────────────────┐
│  ⚠ Dégradé                              │   degraded — md variant (detail header)
└─────────────────────────────────────────┘
   16px       12px font-medium

┌─────────────────────────────────┐
│  ⊘ Déconnecté                   │   offline — sm variant
└─────────────────────────────────┘
```

### Tailwind reference

```tsx
// Pseudo-implementation hint — actual file: ui/src/components/equipments/EquipmentStatusBadge.tsx
const VARIANT = {
  degraded: {
    sm: "bg-warning/10 text-warning text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-1",
    md: "bg-warning/10 text-warning text-[12px] font-medium px-2.5 py-1 rounded-full inline-flex items-center gap-1.5",
    icon: AlertTriangle,
    labelKey: "equipment.status.degraded",
  },
  offline: {
    sm: "bg-error/10 text-error text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-1",
    md: "bg-error/10 text-error text-[12px] font-medium px-2.5 py-1 rounded-full inline-flex items-center gap-1.5",
    icon: WifiOff,
    labelKey: "equipment.status.offline",
  },
};
```

### Tooltip (hover desktop / tap mobile)

Reuses the existing `<Tooltip>` component. Content:

```
┌──────────────────────────────────────┐
│  Dégradé                            │   ← title (text-[13px] font-medium)
│                                      │
│  2 appareils hors ligne :           │   ← text-[12px]
│   • Compteur Shelly                  │
│   • Volet salon                      │
│                                      │
│  1 valeur périmée :                 │
│   • temperature (15 min)             │
│                                      │
│  Hors ligne depuis 47 min            │   ← text-[11px] text-text-tertiary
└──────────────────────────────────────┘
```

---

## 3. Shared inline indicator: stale value

When a single binding value is stale but the equipment isn't fully offline, the **value itself** is greyed + italic + a tiny clock icon, with the relative time in mono.

```
Before:           After (stale):

┌──────────┐      ┌────────────────────┐
│ 21.4 °C  │      │ ⏱ 21.4 °C  3h ago │
└──────────┘      └────────────────────┘
  primary           text-text-tertiary
  font-mono         italic, font-mono
                    clock 12px stroke 1.5
                    "3h ago" mono 10px
```

```tsx
// Tailwind hint
<span className="inline-flex items-center gap-1 text-text-tertiary italic">
  <Clock size={12} strokeWidth={1.5} />
  <span className="font-mono">21.4 °C</span>
  <span className="text-[10px] font-mono">3h ago</span>
</span>
```

---

## 4. Per-screen mockups

### 4.1 CompactEquipmentCard (zone row)

The badge sits in the **top-right of the card**, above any per-type tint chip. Existing layout untouched.

```
ONLINE (default, today's behavior):
┌────────────────────────────────────────────────────────────────┐
│ 💡 Lampe salon                                          ●─────── │
│    Salon                                                  on    │
└────────────────────────────────────────────────────────────────┘

DEGRADED (1 device offline among many, OR 1 streaming binding stale):
The badge sits in the top-right corner. The value stays visible because it's
still vaguely useful (last known reading), greyed + italic + small clock to
signal staleness.
┌────────────────────────────────────────────────────────────────┐
│ ⚡ Compteur principal                          ⚠ Dégradé      │
│    Maison                                       ⏱ 0 W  47m ago │
└────────────────────────────────────────────────────────────────┘

OFFLINE (all bound devices offline OR no bindings at all):
The badge REPLACES the value entirely — "— %" + "2h ago" + badge was visual
noise for the same information. The badge alone carries the status; the age
stays underneath as a discrete mono caption.
┌────────────────────────────────────────────────────────────────┐
│ 🪟 Volet salon                                 ⊘ Déconnecté   │
│    Salon                                                 2h ago│
└────────────────────────────────────────────────────────────────┘
```

**Behavior :**

- **Degraded**: badge `absolute top-2 right-2` (sm variant). Value column keeps its layout, greyed.
- **Offline**: NO top-right badge. Instead, the badge takes the whole value slot (right-aligned column), with the relative age below it in mono `text-[10px] text-text-tertiary`. Cleaner — one signal, not three (badge + dashed value + age).
- Existing controls (slider, buttons) remain interactive in degraded state; in offline state, the controls receive a subtle `opacity-60` but stay clickable (the order will still be attempted — see spec.md Edge Cases).
- The per-type icon tint chip on the left stays unchanged in degraded; muted to `opacity-60` in offline to match the rest of the row.

### 4.2 EquipmentDetailCard (detail page)

Badge in the **header row**, immediately after the equipment name, before the zone name.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🪟  Volet salon  ⊘ Déconnecté                                       │
│     Salon · Maison                                                    │
│                                                                       │
│     Position                                                          │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  ⏱ — %         Last update 2h ago                         │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                       │
│     [ Ouvrir ]   [ Stop ]   [ Fermer ]                               │
│        (opacity-50 controls — clickable but visually muted)           │
└──────────────────────────────────────────────────────────────────────┘
```

**Behavior :**

- Md variant of the badge.
- Controls keep their layout, with `opacity-60` overlay applied at container level when status === offline.
- A small caption line below the value: `Dernière mise à jour il y a 2h` in `text-[11px] text-text-tertiary`.
- No modal, no scary error message; the badge + caption are the entire UX.

### 4.3 LiveEnergyPage (main energy widget)

The most visible surface for the original Shelly bug. The **live power number** is replaced by a stale HUD.

```
ONLINE (today's behavior):
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│                       2 340 W                                  │
│                    Live · 1s ago                               │
│                                                                │
│  ⬇ Réseau 1 800 W       ☀ Solaire 540 W                       │
└────────────────────────────────────────────────────────────────┘

STALE (Shelly disjoncté since 47 min):
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│         ⚠         — — — W                                      │
│                Données live indisponibles                      │
│                Dernière donnée il y a 47 min                   │
│                                                                │
│  ⬇ Réseau  ⏱ 1 800 W 47m ago   ☀ Solaire  ⏱ 540 W 47m ago    │
└────────────────────────────────────────────────────────────────┘
```

**Behavior :**

- Main gauge: large value replaced by `— — — W` in `text-text-tertiary` (28px mono), with `AlertTriangle` icon (24px ambre) prefixed.
- Two captions stacked:
  - `Données live indisponibles` — `text-[14px] text-text-secondary`
  - `Dernière donnée il y a 47 min` — `text-[12px] text-text-tertiary font-mono`
- Sub-sources (Réseau / Solaire) use the inline stale indicator from §3.
- The historical chart below (5-min / 1-day / 1-week) is untouched — it reads from InfluxDB and is by nature historical.

### 4.4 EnergyDataPanel (equipment detail — cumuls block)

Subtle: cumuls (Heure / Jour / Mois / Année) come from InfluxDB so they remain accurate. Only adds a small `Dernière mise à jour…` caption when the live power binding is stale.

```
ONLINE:
┌──────────────────────────────────────────────────────────┐
│ ⚡ Compteur principal                                    │
│                                                          │
│  Heure       Jour        Mois        Année              │
│  1.20 kWh   12.40 kWh   384 kWh    4 320 kWh           │
└──────────────────────────────────────────────────────────┘

DEGRADED (cumuls still valid from InfluxDB, but live is stale):
┌──────────────────────────────────────────────────────────┐
│ ⚡ Compteur principal             ⚠ Dégradé             │
│                                                          │
│  Heure       Jour        Mois        Année              │
│  1.20 kWh   12.40 kWh   384 kWh    4 320 kWh           │
│                                                          │
│  Dernière donnée live il y a 47 min                     │
└──────────────────────────────────────────────────────────┘
```

**Behavior :**

- Cumul values are NOT greyed (they're historical, accurate up to InfluxDB's last write).
- Caption `Dernière donnée live il y a 47 min` appears in `text-[11px] text-text-tertiary` at the bottom of the panel.
- Sm badge in the header.

### 4.5 ZoneWidget (zone tile on dashboard / home page)

Aggregated metrics. When one or more contributing equipments are offline, the count is shown next to the value as a discrete hint.

```
ONLINE (today):
┌────────────────────────────┐
│  🛋 Salon                  │
│                            │
│  🌡 21.4 °C    💧 48 %    │
│  💡 2/3 on    🪟 1/3 open │
└────────────────────────────┘

DEGRADED (1 temperature sensor offline, 1 shutter offline):
┌────────────────────────────┐
│  🛋 Salon  ⚠              │
│                            │
│  🌡 21.4 °C  (1 indispo.) │
│  💧 48 %                   │
│  💡 2/3 on                 │
│  🪟 1/2 open (1 indispo.) │
└────────────────────────────┘
```

**Behavior :**

- A small `AlertTriangle` ambre icon next to the zone name in the header when any equipment in the zone is offline. No badge text needed at this level (compact).
- The `(1 indispo.)` hint appears in `text-[11px] text-text-tertiary` after each affected metric.
- For counts (lights, shutters): the displayed total adapts (2/3 → 2/2 with the hint), so the user understands the count is over the **available** set only.

### 4.6 Dashboard family widgets (Shutters, Awnings, Lights, Sensors, Heating, Water, Pool)

Single badge in the **widget header**, no per-equipment treatment (that's the family widget's whole point: aggregate view).

```
ONLINE:
┌──────────────────────────────────────┐
│  🪟  Volets — Salon          3/3 ▲  │
│                                      │
│         ▲                            │
│      [ Ouvrir tous ]                 │
│      [ Stop ]                        │
│      [ Fermer tous ]                 │
└──────────────────────────────────────┘

DEGRADED (1 shutter offline among 3):
┌──────────────────────────────────────┐
│  🪟  Volets — Salon  ⚠      2/3 ▲   │
│                                      │
│         ▲                            │
│      [ Ouvrir tous ]                 │
│      [ Stop ]                        │
│      [ Fermer tous ]                 │
│                                      │
│      1 volet hors ligne              │
└──────────────────────────────────────┘
```

**Behavior :**

- Sm `AlertTriangle` ambre icon in header, no text label (the caption at the bottom carries the info).
- Caption `1 volet hors ligne` in `text-[11px] text-text-tertiary` at the bottom of the widget.
- Count adapts: 3/3 becomes 2/3 (deployed out of available, hidden equipments not counted).
- Buttons stay enabled — `Fermer tous` still fires for the 2 reachable shutters.

---

## 5. Copy — final EN / FR

| Key                                             | EN                         | FR                                   |
| ----------------------------------------------- | -------------------------- | ------------------------------------ |
| `equipment.status.online`                       | Online                     | En ligne                             |
| `equipment.status.degraded`                     | Degraded                   | Dégradé                              |
| `equipment.status.offline`                      | Disconnected               | Déconnecté                           |
| `equipment.status.tooltip.offlineDevices_one`   | 1 device offline:          | 1 appareil hors ligne :              |
| `equipment.status.tooltip.offlineDevices_other` | {{count}} devices offline: | {{count}} appareils hors ligne :     |
| `equipment.status.tooltip.staleBindings_one`    | 1 stale value:             | 1 valeur périmée :                   |
| `equipment.status.tooltip.staleBindings_other`  | {{count}} stale values:    | {{count}} valeurs périmées :         |
| `equipment.status.tooltip.offlineSince`         | Offline since {{when}}     | Hors ligne depuis {{when}}           |
| `equipment.status.lastUpdate`                   | Last update {{when}}       | Dernière mise à jour il y a {{when}} |
| `energy.live.unavailable`                       | Live data unavailable      | Données live indisponibles           |
| `energy.live.lastDatapoint`                     | Last datapoint {{when}}    | Dernière donnée il y a {{when}}      |
| `zones.aggregate.unavailable_one`               | (1 unavailable)            | (1 indispo.)                         |
| `zones.aggregate.unavailable_other`             | ({{count}} unavailable)    | ({{count}} indispo.)                 |
| `dashboard.family.offlineCount_one`             | 1 device offline           | 1 appareil hors ligne                |
| `dashboard.family.offlineCount_other`           | {{count}} devices offline  | {{count}} appareils hors ligne       |

`{{when}}` is rendered via the existing relative-time formatter (used by `ElapsedCounter`): "47 min", "2h", "3j", etc. No em-dashes anywhere (per project convention).

---

## 6. Responsive behavior

| Breakpoint | Compact card badge         | Detail badge | LiveEnergy HUD                                           |
| ---------- | -------------------------- | ------------ | -------------------------------------------------------- |
| < 640px    | Sm, icon-only (no label)   | Md           | Stack captions, smaller gauge (still text-text-tertiary) |
| ≥ 640px    | Sm, icon + label           | Md           | Inline captions, full-size gauge                         |
| ≥ 1024px   | Sm, icon + label + tooltip | Md + tooltip | Full layout with side-by-side sub-source pills           |

For mobile, the compact card badge collapses to an icon-only chip (no `Dégradé` / `Déconnecté` label) to preserve horizontal space. The tooltip remains accessible on tap.

---

## 7. Accessibility

- Badge has `role="status"` and `aria-label="{{equipment.name}} {{equipment.status}}"`.
- Color is never the only signal: each state also carries a distinct icon (`AlertTriangle`, `WifiOff`).
- Tooltip is reachable via keyboard (`tabindex={0}` on the badge wrapper).
- Stale value inline indicator has `aria-label="Stale value, last updated {{when}}"`.
- Contrast: `text-warning` on `bg-warning/10` and `text-error` on `bg-error/10` already pass WCAG AA in both light and dark mode (verified by existing usages in `ConnectionStatus.tsx`, `HeaderPill.tsx`, sidebar offline badges).

---

## 8. Out of scope for v1

- Per-equipment "disable orders when offline" toggle. Buttons stay clickable; the plugin handles failed dispatch.
- Sound or push notification on equipment transition to offline. Telegram / FCM notification publishers can be wired in a follow-up (would consume `equipment.status.changed`).
- A dedicated "Health" page listing all offline equipments. Today's Devices page already does this at the device level; equipment-level health would be a follow-up.
- Time-series of equipment availability (e.g. "uptime 96.4% this week"). Would need a dedicated InfluxDB series.
