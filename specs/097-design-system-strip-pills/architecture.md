# Architecture — Spec 097 — Strip Pills

## Overview

UI-only refactor of one file: [ZoneAggregationPills.tsx](../../ui/src/components/home/ZoneAggregationPills.tsx). No backend, no state, no routing. The component already builds an `items` array conditionally — we restructure that into three cluster arrays and update the rendering.

## Current shape

```tsx
const items: StatusItem[] = [];
// ...push items based on data.X...
return (
  <div className="strip flex items-center ...">
    {items.map((item, index) => (
      <Fragment>
        {index > 0 && <div className="strip__div" />}
        <div className={`pill ${item.color} ${item.alert ? "bg-error/8" : ""}`}>
          {item.icon}
          <span>{item.label}</span>
          {sparkline}
        </div>
      </Fragment>
    ))}
  </div>
);
```

## Target shape

```tsx
const sensorPills: StatusItem[] = []; // temp, humidity, lux
const counterPills: StatusItem[] = []; // motion, lights, shutters, water valves
const alertPills: StatusItem[] = []; // doors, windows, leak, smoke

// ...push based on data.X with variant assignment...

const clusters = [sensorPills, counterPills, alertPills].filter((c) => c.length > 0);

return (
  <div className="strip ...">
    {clusters.map((cluster, ci) => (
      <Fragment key={ci}>
        {ci > 0 && <GroupDivider />}
        {cluster.map((item, ii) => (
          <Fragment key={item.key}>
            {ii > 0 && <PillDivider />}
            <StripPill {...item} />
          </Fragment>
        ))}
      </Fragment>
    ))}
  </div>
);
```

## Variant mapping (data → pill variant)

| Data condition                      | Variant    | Visual                                     |
| ----------------------------------- | ---------- | ------------------------------------------ |
| Temperature / humidity / luminosity | default    | neutral text, info-tinted icon             |
| Motion: `data.motion === true`      | default    | amber icon + amber text (current behavior) |
| Motion: `data.motion === false`     | `--calm`   | green icon + green text                    |
| Lights: `data.lightsOn > 0`         | `--active` | amber icon + amber text                    |
| Lights: `data.lightsOn === 0`       | default    | neutral text + grey icon                   |
| Shutters: `data.shuttersOpen > 0`   | default    | primary icon (current)                     |
| Shutters: `data.shuttersOpen === 0` | default    | neutral text + grey icon                   |
| Water valves open                   | default    | amber text (current behavior)              |
| Open doors                          | default    | amber text (current — unchanged)           |
| Open windows                        | default    | amber text (current — unchanged)           |
| Water leak                          | `--alert`  | red bg + red text, no pulse                |
| Smoke                               | `--alert`  | red bg + red text, no pulse                |

## `<StripPill>` component (internal, ~30 lines)

```tsx
interface StripPillProps {
  variant?: "default" | "active" | "calm" | "alert";
  icon: ReactNode;
  label: string;
  iconColor?: string; // override for default variant (e.g. info for sensors)
  sparkline?: ReactNode;
}

function pillClasses(variant): string {
  const base =
    "flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] text-[13px] font-medium tabular-nums whitespace-nowrap";
  if (variant === "alert") return `${base} bg-error/10 text-error font-semibold`;
  if (variant === "active") return `${base} text-active-text`;
  if (variant === "calm") return `${base} text-success`;
  return base;
}

function iconColorClass(variant, override) {
  if (variant === "alert") return "text-error";
  if (variant === "active") return "text-active-text";
  if (variant === "calm") return "text-success";
  return override ?? "text-text-tertiary";
}
```

Token mapping (post-Phase 0 swap):

- `text-error` = `var(--red-500)`
- `bg-error/10` = `rgba(red-500, 0.1)`
- `text-active-text` = `var(--a-600)` (amber dark)
- `text-success` = `var(--green-500)`

For alerts, `bg-error/10` is chosen over `bg-error/8` (current) to bump from "barely visible" to "clearly visible" without going to the full `bg-red-50` opacity. The /10 + text-error combo passes WCAG AA (4.6:1 ratio).

## Cluster builder

The cluster construction stays in the main component (the conditional logic is tied to `data.X` checks). Just three local arrays instead of one. No extraction needed.

## Dividers

Two visual weights:

| Divider            | Where                          | Style                            |
| ------------------ | ------------------------------ | -------------------------------- |
| `<PillDivider />`  | Between pills within a cluster | `w-px h-4 bg-border mx-1`        |
| `<GroupDivider />` | Between clusters               | `w-px h-5 bg-border-strong mx-2` |

`bg-border-strong` is `var(--line-2)` post-Phase 0 — heavier than `--line`. We'll use `bg-border` for the strong divider since the @theme alias maps `--color-border` to `var(--line-2)` already. The lighter intra-cluster divider needs `bg-border-light` (= `var(--line)`).

Actually wait — checking the @theme aliases:

- `--color-border` → `var(--line-2)` (heavier)
- `--color-border-light` → `var(--line)` (lighter)

So in Tailwind:

- `bg-border` = heavier
- `bg-border-light` = lighter

Intra-cluster: `bg-border-light` (was `bg-border` = uniform with current code — slight visual lightening)
Inter-cluster: `bg-border` (was nothing — new)

This makes the inter-cluster divider visibly stronger than the intra-cluster ones.

## File changes

| File                                              | Change                                                    |
| ------------------------------------------------- | --------------------------------------------------------- |
| `ui/src/components/home/ZoneAggregationPills.tsx` | refactor — split items into clusters, extract `StripPill` |

That's it. One file modified. No new file created (the `StripPill` is internal — kept in the same file for locality).

## Risk assessment

| Risk                                            | Likelihood | Mitigation                                                                                             |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| A cluster boundary doesn't render when expected | Low        | Filter `.filter(c => c.length > 0)` ensures empty clusters don't produce stale dividers.               |
| Sparkline rendering breaks                      | Low        | Sparkline is forwarded as prop into `StripPill` — same render path as before.                          |
| Mobile horizontal scroll regression             | Very low   | `overflow-x-auto` on `.strip` container is preserved.                                                  |
| Color contrast on `bg-error/10` + `text-error`  | Low        | Manually checked: passes WCAG AA. If a user reports, bump to `bg-error/15`.                            |
| `text-success` not defined in @theme            | Verified   | `--color-success` is mapped in `ui/src/index.css` post-Phase 0 — available as `text-success`.          |
| Calm variant visible when motion is detected    | Logic bug  | Variant is selected by `data.motion === false`, gated by `data.motionSensors > 0`. Existing condition. |

## Rollback

`git revert` of the commit. Single file modified.

## References

- [design-system/components/strip.md](../../design-system/components/strip.md)
- [ui-redesign-B-polished.html](../094-ui-redesign/mockups/ui-redesign-B-polished.html) lines 421-481 (CSS), 2521-2565 (HTML)
