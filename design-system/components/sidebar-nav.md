# Sidebar navigation (`sb`)

> The vertical navigation rail on the left of the desktop view. Contains the Sowel logo, top-level nav items (Dashboard, Maison, Modes, Analyse, Énergie), the zone tree under Maison, and Administration/Réglages pinned at the bottom.

---

## Anatomy

```
┌─ Sidebar 220px ────────────────────┐
│ [logo] SOWEL                       │  .sb__logo  (49 px)
├────────────────────────────────────┤
│   Dashboard                        │  .sb__item
│   Maison                ⌄          │  .sb__item (expanded)
│      › Extérieur                   │  .sb__sub > .sb__item
│      › Sous-sol                    │
│      › RDC              ⌄          │  (expanded — chevron rotated)
│         · Entrée                   │  .sb__sub-deeper > .sb__item
│         · Bureau                   │
│         · Séjour          ←active  │  .sb__item--active (pill, primary tint)
│         · Cuisine                  │
│      › Etage 1                     │
│      › Etage 2                     │
├────────────────────────────────────┤  .sb__sep (1 px line)
│   Modes                            │
├────────────────────────────────────┤  .sb__sep
│   Analyse                          │
├────────────────────────────────────┤  .sb__sep
│   Énergie                          │
├────────────────────────────────────┤  .sb__sep
│                                    │  flex grow
│   Administration         (pinned)  │  margin-top: auto
│   Réglages                         │
└────────────────────────────────────┘
```

---

## Items as pills

Every item is rendered as a **pill** (rounded rect with margin). Hovers and active states swap the pill background. This is the **only** hover treatment in the entire system that uses a pill highlight pattern — copy-cat from Linear / Notion.

| State        | bg                          | text      | icon                                  |
| ------------ | --------------------------- | --------- | ------------------------------------- |
| Default      | transparent                 | `--n-600` | `--n-500`, opacity .75                |
| Hover        | `--n-50` (neutral!)         | `--n-800` | opacity 1                             |
| **Active**   | **`--p-50`** (primary tint) | `--p-500` | `--p-500`, opacity 1, font-weight 600 |
| Active hover | `color-mix(p-500 12%)`      | `--p-500` | `--p-500`                             |

The critical design choice: **hover is neutral, active is primary**. They never share the same tint. The user explicitly called this out — earlier versions tinted hover with primary too, which was confusing.

---

## Tree expand chevrons

Sub-zones (Extérieur, Sous-sol, RDC…) are expandable. The chevron lives **on the left** of the label (matches production):

```html
<div class="sb__item"><span class="sb__exp">›</span> Extérieur</div>
<div class="sb__item"><span class="sb__exp sb__exp--open">›</span> RDC</div>
```

The `--open` modifier rotates the chevron 90° via CSS. Leaf zones (Séjour, Bureau…) have an invisible placeholder `<span class="sb__exp sb__exp--leaf"></span>` to keep their text aligned with the parent zones.

---

## Section separators

The pinned zone tree is surrounded by horizontal rules. Three top-level items (Modes, Analyse, Énergie) each get a separator above to visually isolate them:

```
─────  (sep)
Modes
─────  (sep)
Analyse
─────  (sep)
Énergie
─────  (sep)
```

This pattern came from the user request "il faut les séparer mode analyse et energie avec des séparation horizontales". It's intentional, not decorative — those three items are different in nature (Modes = behavior config, Analyse = data, Énergie = monitoring) so the separators signal "different scopes".

---

## Code

### HTML

```html
<aside class="sb">
  <div class="sb__logo">
    <svg>…house silhouette…</svg>
    <b>SOWEL</b>
  </div>

  <div class="sb__item"><svg class="sb__item-icon">…</svg>Dashboard</div>
  <div class="sb__item">
    <svg class="sb__item-icon">…</svg>Maison <span class="sb__chev">⌄</span>
  </div>
  <div class="sb__sub">
    <div class="sb__item"><span class="sb__exp">›</span>Extérieur</div>
    <div class="sb__item"><span class="sb__exp sb__exp--open">›</span>RDC</div>
    <div class="sb__sub sb__sub-deeper">
      <div class="sb__item"><span class="sb__exp sb__exp--leaf"></span>Entrée</div>
      <div class="sb__item sb__item--active"><span class="sb__exp sb__exp--leaf"></span>Séjour</div>
    </div>
  </div>

  <div class="sb__sep"></div>
  <div class="sb__item"><svg class="sb__item-icon">…Layers…</svg>Modes</div>
  <div class="sb__sep"></div>
  <div class="sb__item"><svg class="sb__item-icon">…BarChart3…</svg>Analyse</div>
  <div class="sb__sep"></div>
  <div class="sb__item"><svg class="sb__item-icon">…Zap…</svg>Énergie</div>
  <div class="sb__sep"></div>

  <div class="sb__item" style="margin-top:auto">
    <svg class="sb__item-icon">…Shield…</svg>Administration
  </div>
  <div class="sb__item"><svg class="sb__item-icon">…Settings…</svg>Réglages</div>
</aside>
```

### CSS (key rules)

```css
.sb {
  background: var(--n-0);
  border-right: 1px solid var(--line);
  font-size: var(--fs-body);
  display: flex;
  flex-direction: column;
}

.sb__logo {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.75rem 1.15rem;
  height: 49px; /* aligns with topbar height */
  box-sizing: border-box;
  border-bottom: 1px solid var(--line);
  margin-bottom: 0.85rem;
}
.sb__logo svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.sb__logo b {
  font-weight: 600;
  color: var(--p-500);
  font-size: var(--fs-body);
}

.sb__item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin: 1px 0.55rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--r-sm);
  color: var(--n-600);
  font-weight: 500;
  font-size: var(--fs-small);
  cursor: pointer;
  transition:
    background-color 140ms,
    color 140ms;
}
.sb__item:hover {
  background: var(--n-50);
  color: var(--n-800);
}
.sb__item:hover .sb__item-icon {
  opacity: 1;
}

.sb__item--active {
  background: var(--p-50);
  color: var(--p-500);
  font-weight: 600;
}
.sb__item--active .sb__item-icon {
  color: var(--p-500);
  opacity: 1;
}
.sb__item--active:hover {
  background: color-mix(in srgb, var(--p-500) 12%, transparent);
  color: var(--p-500);
}

.sb__item-icon {
  width: 16px;
  height: 16px;
  opacity: 0.75;
  transition:
    opacity 140ms,
    color 140ms;
}
.sb__chev {
  margin-left: auto;
  opacity: 0.5;
  font-size: var(--fs-micro);
}

.sb__sub {
  display: flex;
  flex-direction: column;
  padding-left: 0.65rem;
}
.sb__sub .sb__item {
  padding-left: 1.35rem;
  font-size: var(--fs-caption);
}
.sb__sub-deeper .sb__item {
  padding-left: 1.6rem;
}

.sb__sep {
  height: 1px;
  background: var(--line);
  margin: 0.35rem 0.85rem;
}

.sb__exp {
  display: inline-flex;
  width: 12px;
  height: 12px;
  align-items: center;
  justify-content: center;
  color: var(--n-400);
  font-size: var(--fs-body);
  transition: transform 160ms;
  flex: none;
}
.sb__exp--open {
  transform: rotate(90deg);
  color: var(--n-600);
}
.sb__exp--leaf {
  visibility: hidden;
}
```

---

## Icon usage (Lucide, stroke 1.5–1.7)

| Item                          | Icon                          | Notes                                     |
| ----------------------------- | ----------------------------- | ----------------------------------------- |
| Dashboard                     | `Grid3x3` (4-square grid)     | matches production                        |
| Maison                        | `Home` (house outline)        | matches production                        |
| Sub-zones (Extérieur, RDC, …) | `Layers` (3 stacked)          | matches production sidebar zone tree      |
| Leaf zones (Séjour, Bureau)   | `Building` (door icon)        | matches production                        |
| Modes                         | **`Layers`**                  | confirmed via Sidebar.tsx + AppLayout.tsx |
| Analyse                       | `BarChart3` (3 vertical bars) | matches production                        |
| Énergie                       | `Zap` (lightning bolt)        | matches production                        |
| Administration                | `Shield`                      | matches production                        |
| Réglages                      | `Settings` (cog)              | matches production                        |

---

## Accessibility

| Concern | Implementation |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Nav landmark | The sidebar should be a `<nav aria-label="Navigation principale">` in production. The mock uses `<aside>` for visual demo. |
| Active item | Production must set `aria-current="page"` on the active sb**item. The CSS targets `.sb**item--active`, but `aria-current` is the accessible signal. |
| Keyboard navigation | Each `sb__item` must be focusable. Production wraps the content in a `<Link>` or `<button>`. The mock uses `<div>` purely visual. |
| Chevron expand | The expand chevron should be inside a `<button aria-expanded="true                                                                                                                                                                       | false" aria-controls="…">` for keyboard expand/collapse. |
| Color contrast | `--n-600` on `--n-0`: 11.6:1 (AAA). `--n-800` (active text) on `--p-50`: AAA. |
| Touch target | Items are 30 px tall (incl. margin). Below Apple HIG 44 px for touch. **The desktop sidebar is mouse-driven**, so this is acceptable. The mobile equivalent uses a 56 px-tall bottom tab bar (see [mobile-tabbar.md](mobile-tabbar.md)). |

---

## Do / Don't

✅ **Do**: use the pill margin pattern (`margin: 1px .55rem`) so items don't touch the sidebar edges.
✅ **Do**: keep the active state distinctly **primary**, never neutral. The user must spot "where I am" instantly.
✅ **Do**: use Lucide icons aligned with production (Layers for Modes, not toggle switch).

❌ **Don't**: add a left inset bar to active items. The pill itself is the visual anchor; a bar would protrude from the rounded edge.
❌ **Don't**: tint the hover with primary. Neutral hover, primary active — the distinction matters.
❌ **Don't**: stretch items full-width. The pill inset is part of the modern feel.

---

## React mapping (proposal)

```tsx
<Sidebar>
  <SidebarItem icon={<Grid3x3 />} label="Dashboard" to="/dashboard" />
  <SidebarItem icon={<Home />} label="Maison" expandable defaultOpen>
    <SidebarTree zones={zones} activeZoneId={zoneId} />
  </SidebarItem>
  <SidebarSeparator />
  <SidebarItem icon={<Layers />} label="Modes" to="/modes" />
  <SidebarSeparator />
  <SidebarItem icon={<BarChart3 />} label="Analyse" to="/analyse" />
  <SidebarSeparator />
  <SidebarItem icon={<Zap />} label="Énergie" to="/energy" />
  <SidebarItem icon={<Shield />} label="Administration" pinBottom />
  <SidebarItem icon={<Settings />} label="Réglages" />
</Sidebar>
```

---

## See also

- [topbar.md](topbar.md) — Horizontal nav at the top of the page.
- [mobile-tabbar.md](mobile-tabbar.md) — Mobile equivalent.
