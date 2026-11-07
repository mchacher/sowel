# Shutter button group (`shutter-grp`)

> Segmented control of three buttons (open ↑ / stop ■ / close ↓) for individual shutter equipment. The 3 commands are non-negotiable — they match the production hardware capability.

---

## Anatomy

```
┌────┬────┬────┐
│  ↑ │  ■ │  ↓ │   3 buttons, 30 × 30 each, joined by shutter-500 borders
└────┴────┴────┘
```

---

## States

| State                                | Class                    | Effect                         |
| ------------------------------------ | ------------------------ | ------------------------------ |
| Inactive                             | `.shutter-btn`           | white bg, shutter-500 icon     |
| Hover                                | `.shutter-btn:hover`     | bg `--shutter-50`              |
| Active (current direction in motion) | `.shutter-btn.is-active` | bg `--shutter-500`, icon white |

The `is-active` modifier is data-driven by production:

- Shutter is opening → up arrow has `.is-active`
- Shutter is closing → down arrow has `.is-active`
- Shutter is at rest → no `.is-active`
- Stop ■ never has `.is-active` (it's a one-shot command, no rest state)

---

## Code

```html
<div class="shutter-grp">
  <button class="shutter-btn" title="Ouvrir Volet Ouest" aria-label="Ouvrir Volet Ouest">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  </button>
  <button class="shutter-btn" title="Stop Volet Ouest" aria-label="Stop Volet Ouest">
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="8" y="8" width="8" height="8" rx="1.2" />
    </svg>
  </button>
  <button class="shutter-btn" title="Fermer Volet Ouest" aria-label="Fermer Volet Ouest">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>
</div>
```

```css
.shutter-grp {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--shutter-500);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.shutter-grp .shutter-btn {
  width: 30px;
  height: 30px;
  background: var(--n-0);
  color: var(--shutter-500);
  border: none;
  border-right: 1px solid var(--shutter-500);
  border-radius: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.shutter-grp .shutter-btn:last-child {
  border-right: none;
}
.shutter-grp .shutter-btn svg {
  width: 12px;
  height: 12px;
}
.shutter-grp .shutter-btn:hover {
  background: var(--shutter-50);
}
.shutter-grp .shutter-btn.is-active {
  background: var(--shutter-500);
  color: var(--n-0);
}
```

---

## Horizontal variant (`.shutter-grp--horizontal`) — pool covers

Pool covers slide left ↔ right (not up ↕ down). The group uses **horizontal chevrons** instead of vertical ones:

```html
<div class="shutter-grp shutter-grp--horizontal">
  <button class="shutter-btn" title="Ouvrir piscine" aria-label="Ouvrir cover piscine">
    <svg
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </button>
  <button class="shutter-btn" title="Stop">…square…</button>
  <button class="shutter-btn" title="Fermer">…ChevronRight…</button>
</div>
```

No CSS change is needed — only the SVG glyphs differ. The `--horizontal` modifier exists only to make intent explicit.

---

## Mobile variant (`.mob__shutter-grp`)

Same structure, slightly different metrics:

```css
.mob__shutter-grp button {
  width: 30px;
  height: 32px;
}
.mob__shutter-grp button svg {
  width: 12px;
  height: 12px;
}
```

The mobile group keeps the 3 buttons (the user explicitly required this — single-button shortcuts were rejected as confusing).

---

## Accessibility

| Concern           | Implementation                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Group role        | Wrap with `role="group" aria-label="Volet Ouest"` so screen readers announce the group.                                                     |
| Per-button labels | Each `aria-label` must include the equipment name ("Ouvrir Volet Ouest", not just "Ouvrir").                                                |
| Stop semantics    | The stop ■ is a momentary action with no persistent state. Don't try to mark it as `aria-pressed`.                                          |
| Touch target      | 30 × 30 is below 44 × 44. Compact context tolerates this, but mobile production may extend the visual to 36 × 36 if testing reveals issues. |
| Color contrast    | Shutter icon `--shutter-500` (`#4F5763`) on white: 7.4:1 — AAA. Active state white on shutter: 7.4:1 — AAA.                                 |

---

## Do / Don't

✅ **Do**: keep all 3 buttons. The 2-button variant (open/close) loses the stop affordance.
✅ **Do**: use the segmented look (shared border, no per-button radius). It signals "one logical control".
✅ **Do**: use the same component for `gate` if the gate has open/stop/close commands. Otherwise use [a single gate-cmd button](eq-row.md#variants).

❌ **Don't**: split into 3 separate `power-btn`s with gaps. The segmented look is the visual signal.
❌ **Don't**: hide the stop button. Some users have shutters that take 30 s to fully close — stop is essential mid-motion.
❌ **Don't**: substitute for a slider on shutters. Sliders set absolute position; the segmented group sets direction. Both can coexist on the same row (slider for position, group for direction commands).

---

## React mapping (proposal)

```tsx
type ShutterGroupProps = {
  equipmentName: string;
  direction: "opening" | "closing" | "idle";
  onOpen: () => void;
  onStop: () => void;
  onClose: () => void;
};

<ShutterGroup
  equipmentName="Volet Ouest"
  direction={shutter.movement ?? "idle"}
  onOpen={() => orderShutter(shutter, "open")}
  onStop={() => orderShutter(shutter, "stop")}
  onClose={() => orderShutter(shutter, "close")}
/>;
```

The `.is-active` class is applied to the button matching `direction`.

---

## See also

- [eq-row.md](eq-row.md) — Used on shutter, gate, and pool_cover row variants
- [zone-commands.md](zone-commands.md) — Cousin pattern for zone-level shutter commands
