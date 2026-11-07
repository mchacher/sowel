# Topbar (`topbar`)

> **Superseded in part by [tokens.md](../tokens.md) (spec 196).** Labels are sentence case and numbers Inter with tabular figures (§2), radii are 6 / 10 / 16 px (§4), and a card or panel has no border (§5.1). Where the CSS below disagrees, tokens.md wins.

> Horizontal bar at the top of the desktop main area. Contains the breadcrumb, time/sunlight chips, connection status, alarms pill, and the avatar.

---

## Anatomy

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Grange Neuve › RDC › Séjour  …  [🕐 22:57]  [☀ 06:14—20:54 Nuit]  [● Connecté]  [⚠ 2]  [MC Marc] │
└──────────────────────────────────────────────────────────────────────────────────────┘
   breadcrumb (left)                          chips (right, with spacer before)
                                                                                      height 49 px
```

The topbar height (49 px) **exactly matches the sidebar logo height**. This ensures the two share a perfect horizontal baseline.

---

## Slots (in order, left to right)

| Slot                      | Class                                                | Required             |
| ------------------------- | ---------------------------------------------------- | -------------------- |
| Breadcrumb                | `.topbar__breadcrumb`                                | yes                  |
| Spacer                    | `.topbar__spacer`                                    | yes                  |
| Time chip                 | `.topbar__chip` (mono)                               | recommended          |
| Sunlight chip             | `.topbar__chip topbar__chip--sun` (amber-tinted)     | recommended          |
| Connection status         | `.topbar__conn topbar__conn--connected`              | yes                  |
| Alarms pill (conditional) | `.topbar__alarm topbar__alarm--warning` or `--error` | only if alarms exist |
| Avatar                    | `.topbar__avatar`                                    | yes                  |

---

## Code

```html
<div class="topbar">
  <div class="topbar__breadcrumb">
    Grange Neuve <span class="sep">›</span> RDC <span class="sep">›</span>
    <b>Séjour</b>
  </div>

  <div class="topbar__spacer"></div>

  <!-- Time -->
  <div class="topbar__chip" title="Heure courante">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
    22:57:12
  </div>

  <!-- Sunlight (amber-tinted chip) -->
  <div class="topbar__chip topbar__chip--sun" title="Lever 06:14 — coucher 20:54">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
    06:14 — 20:54 <span class="topbar__chip-tag">Nuit</span>
  </div>

  <!-- Connection (green) -->
  <div class="topbar__conn topbar__conn--connected" title="Connecté au moteur Sowel">
    <span class="topbar__conn-dot"></span>
    <span class="topbar__conn-lab">Connecté</span>
  </div>

  <!-- Alarms (warning) -->
  <button class="topbar__alarm topbar__alarm--warning" title="2 alertes système">
    <svg>… AlertTriangle …</svg>
    <span class="topbar__alarm-count">2</span>
  </button>

  <!-- Avatar -->
  <div class="topbar__avatar">
    <div class="topbar__avatar-pic">MC</div>
    Marc
  </div>
</div>
```

```css
.topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  height: 49px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--line);
  background: var(--n-0);
}

.topbar__breadcrumb {
  font-size: 0.82rem;
  color: var(--n-400);
  font-weight: 500;
}
.topbar__breadcrumb b {
  color: var(--n-700);
  font-weight: 600;
}
.topbar__breadcrumb .sep {
  margin: 0 0.35rem;
  opacity: 0.35;
}
.topbar__spacer {
  flex: 1;
}

.topbar__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.65rem;
  background: var(--n-50);
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  font-size: 0.76rem;
  color: var(--n-500);
  font-family: var(--font-mono);
}
.topbar__chip svg {
  width: 12px;
  height: 12px;
  opacity: 0.7;
}

.topbar__chip--sun {
  background: color-mix(in srgb, var(--a-500) 10%, transparent);
  color: var(--a-600);
  border-color: color-mix(in srgb, var(--a-500) 22%, transparent);
}
.topbar__chip--sun svg {
  color: var(--a-500);
  opacity: 0.9;
}
.topbar__chip-tag {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 0.7rem;
  color: color-mix(in srgb, var(--a-600) 80%, var(--n-700));
  margin-left: 0.25rem;
  text-transform: lowercase;
}

.topbar__conn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.8rem;
  border-radius: var(--r-full);
  font-size: 0.76rem;
  font-weight: 500;
}
.topbar__conn--connected {
  background: color-mix(in srgb, var(--green-500) 10%, transparent);
  color: var(--green-700);
}
.topbar__conn-dot {
  position: relative;
  display: inline-flex;
  width: 8px;
  height: 8px;
}
.topbar__conn-dot::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: currentColor;
}
.topbar__conn--connected .topbar__conn-dot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--green-500);
  animation: connPing 1.8s ease-in-out infinite;
  opacity: 0.6;
}

.topbar__alarm {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.6rem;
  border-radius: var(--r-full);
  border: none;
  cursor: pointer;
  font-size: 0.76rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--a-500) 14%, transparent);
  color: var(--a-600);
}
.topbar__alarm--error {
  background: color-mix(in srgb, var(--red-500) 12%, transparent);
  color: var(--red-500);
}
.topbar__alarm svg {
  width: 13px;
  height: 13px;
  flex: none;
}
.topbar__alarm-count {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
}
```

---

## Alarm pill semantics

The alarm pill is only rendered if `issues.length > 0`. Production logic (from `AppLayout.tsx:51`):

- If any issue has level `'error'` → `--error` (red tone)
- Otherwise → `--warning` (amber tone)

Click opens the alarms sheet (production: `AlarmsSheet.tsx`).

---

## Accessibility

| Concern           | Implementation                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Landmark          | Wrap as `<header role="banner">` in production.                                                                                                  |
| Breadcrumb role   | Should be `<nav aria-label="Fil d'Ariane">` with an `<ol>` of `<li>`. The visual `›` separators are decorative — must have `aria-hidden="true"`. |
| Alarm button      | The button has `aria-label` matching the count ("2 alertes système"). Production may also add `aria-haspopup="dialog"` since it opens a sheet.   |
| Connection status | `<div role="status">` for the connection indicator if it changes dynamically (so screen readers announce "Déconnecté" when the WebSocket drops). |
| Reduced motion    | The `connPing` animation honors `prefers-reduced-motion`.                                                                                        |
| Color contrast    | All combinations pass AA (see [accessibility.md § 3](../accessibility.md)).                                                                      |
| Avatar            | `aria-label="Compte de Marc (admin)"` for the avatar block.                                                                                      |

---

## Do / Don't

✅ **Do**: keep the chips in the order time → sunlight → connection → alarms → avatar. The user must see status BEFORE personal context.
✅ **Do**: only show the alarms pill if alarms exist. Don't render an empty "0 alertes" pill.
✅ **Do**: keep the sunlight chip's amber tint. It's the warm signal that says "this is about light cycles", paired with our amber accent.

❌ **Don't**: remove the spacer. Without it, all chips clump left and the breadcrumb loses focus.
❌ **Don't**: add a search input here. Search lives in a different surface (sidebar or dedicated overlay).
❌ **Don't**: collapse the breadcrumb to "Séjour" alone. The full path is part of orientation.

---

## React mapping (proposal)

```tsx
<Topbar>
  <Breadcrumb segments={["Grange Neuve", "RDC", { label: "Séjour", current: true }]} />
  <Spacer />
  <TimeChip time={now} />
  <SunlightChip sunrise={sunrise} sunset={sunset} phase={phase} />
  <ConnectionStatus status={wsStatus} />
  {issues.length > 0 && <AlarmsPill count={issues.length} tone={tone} onClick={openSheet} />}
  <Avatar user={user} />
</Topbar>
```

Production references:

- `ConnectionStatus.tsx` — green dot pattern
- `CurrentTimePill.tsx` — time chip
- `SunlightBanner.tsx` — sunlight chip
- `HeaderPill.tsx` — alarms pill pattern

---

## See also

- [sidebar-nav.md](sidebar-nav.md) — Vertical companion. Shares the 49 px height.
- [mobile-tabbar.md](mobile-tabbar.md) — Mobile replaces the topbar with a different chrome.
