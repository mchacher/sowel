# Spec 126 — Recipe `select` slot type + `getSunlight()` helper

## Context

Recipe slots today are limited to `zone | equipment | number | duration | time | boolean | text | data-key` (`RecipeSlotDef.type`). There is no native dropdown/select control, so a recipe cannot offer a small closed list of named choices with a clean UI — the only workarounds are free-text or stacks of booleans.

This blocks the next evolution of the external `schedule-on-off` recipe (requested feature): letting each daily window boundary be a **fixed time, sunrise, or sunset** (with an offset). That is a 3-way choice that wants a dropdown.

Sunlight data already exists (`SunlightManager`, spec 023) and is technically reachable by recipes today via `ctx.zoneAggregator.getByZoneId(ROOT_ZONE_ID)` — `state-trigger-light` already does this for its `nightOnly` filter (reads `isDaylight`; the same row also carries `sunrise`/`sunset`). A first-class helper avoids recipes hardcoding `ROOT_ZONE_ID` and returns the sun times directly.

This spec covers the **core (main repo)** changes only. The `schedule-on-off` v2 recipe that consumes them is a follow-up in its own repo.

## Goals

1. Add a `select` recipe slot type: a closed list of `{ value, label }` options rendered as a dropdown in the recipe form, with per-language label translation carried in the recipe's own i18n (consistent with how slot names/descriptions are translated).
2. Add `ctx.helpers.getSunlight(): { sunrise, sunset, isDaylight }`, a thin convenience over the existing `SunlightManager`, so recipes can read the sun times without hardcoding `ROOT_ZONE_ID`.

## Non-Goals

- The `schedule-on-off` v2 recipe itself (separate repo, follow-up).
- Any new sunrise/sunset computation — `getSunlight()` reuses `SunlightManager.getSunlightData()` unchanged.
- Generic engine-side validation of select values against `options` — each recipe's own `validate()` owns param validation (the engine already does no per-type slot validation).
- A new SQLite table or migration — recipe instance params are already stored as JSON; a select value is just a string.

## Functional Requirements

### FR1 — `select` slot type

- `RecipeSlotDef.type` gains `"select"`. `RecipeSlotDef` gains an optional `options?: { value: string; label: string }[]` field (`label` is the English fallback).
- `RecipeSlotI18n` gains an optional `options?: Record<string, string>` map (option `value` → translated label).
- The recipe form renders a `select` slot as a dropdown; the chosen option's `value` (a string) becomes the slot's param value. `defaultValue` pre-selects an option.
- Option labels resolve with the fallback chain `i18n[lang].slots[slotId].options[value] → slot.options[].label → value`, mirroring the existing slot-name/description i18n helpers.
- `options` round-trips through the existing `RecipeInfo` serialization to `GET /api/v1/recipes` (slots are passed through verbatim — no extra serialization work).

### FR2 — `getSunlight()` helper

- `RecipeHelpers` (`src/shared/types.ts`) gains `getSunlight(): SunlightData` where `SunlightData = { sunrise: string | null; sunset: string | null; isDaylight: boolean | null }`.
- `RecipeManager` receives the `SunlightManager` instance and wires `getSunlight` to `sunlightManager.getSunlightData()`.
- The helper reflects the same offsets and daily recompute the rest of Sowel uses; recipes pair it with the existing `sunlight.changed` event to re-sync across days.

## Acceptance Criteria

- [x] A recipe can declare a `type: "select"` slot with `options`, and the recipe form shows a working dropdown whose selection is persisted as the param value.
- [x] Option labels are localized (FR/EN) via the recipe's `i18n.slots[id].options`, falling back to the English `label`, then the raw `value`.
- [x] `GET /api/v1/recipes` returns `options` on select slots.
- [x] `ctx.helpers.getSunlight()` returns the current `{ sunrise, sunset, isDaylight }` from `SunlightManager` inside a running recipe instance.
- [x] Existing recipes and slot types are unaffected (no behavior change for non-select slots; `getSunlight` is additive).
- [x] `tsc` (backend + UI), `eslint`, and `vitest` all pass.

## Edge Cases

- **`select` slot with no/empty `options`**: render nothing selectable (or an empty dropdown); the recipe author is responsible for providing options. Not a core crash.
- **Selected value not in `options`** (e.g. stale param after an options change): the dropdown shows the raw stored value; the recipe's `validate()` is the gate that rejects unknown values.
- **Missing option i18n for a language**: fall back to the English `label`, then the `value`.
- **`getSunlight()` before sun is computed / no home coordinates**: returns `{ sunrise: null, sunset: null, isDaylight: null }` (whatever `SunlightManager` currently holds) — never throws. Consuming recipes decide how to handle nulls (the `schedule-on-off` v2 will skip a sun-based boundary on null days).
