# Architecture — Spec 130

Two repositories change. No database, no event, no API change.

## 1. Core (this repo) — reusable multi-select `select` slot

### Types

No change. `RecipeSlotDef` (`src/shared/types.ts`) already declares `type: "select"`,
`options`, and `list`. `RecipeSlotI18n.options` (spec 126) already carries per-option
labels. We are only teaching the **renderer** to honor `list: true` on a `select`.

### UI — `ui/src/components/recipes/ZoneRecipesSection.tsx`

Today `slot.list` is only handled for `equipment` slots; a `select` always renders a
single `<select>` (grouped path ~L824, ungrouped path ~L949). A `select` + `list`
must instead render a **chip group** (one toggle button per option), storing the
selected values the same way equipment lists do — a comma-joined string in
`params[slot.id]` (`"mon,tue,thu,fri"`).

Changes (mirrored in **both** render blocks — the edit block ~L744-978 and the add
block ~L1800+):

1. Add a shared render helper `renderMultiSelectChips(slot, value, onChange)` that
   maps `slot.options` to toggle buttons, reading/writing the comma-joined value and
   resolving labels via the existing `recipeSlotOptionLabel(recipe, slot, value, lang)`.
2. **Grouped path**: a `select` + `list` slot renders **full-width** inside the group
   (like the equipment-list block), placed after the compact Heure/Durée grid. It is
   therefore excluded from the compact-grid filter (the filter that currently excludes
   only `equipment && list`).
3. **Ungrouped path**: the `slot.type === "select"` branch checks `slot.list` and
   renders chips instead of a `<select>`.
4. Styling: reuse Sowel tokens — selected chip = `bg-primary text-white`, unselected =
   `bg-surface border-border`, Tailwind only, matches the approved mock.

A `select` **without** `list` keeps its current single-dropdown rendering (no regression).

## 2. Recipe — `sowel-recipe-auto-watering` (separate repo)

### Mirrored types (`src/index.ts`)

- Extend the local `RecipeSlotDef.type` union with `"select"`.
- Add `options?: { value: string; label: string }[]` to the local `RecipeSlotDef`.
- Add `options?: Record<string, string>` to the local `RecipeSlotI18n`.

### Slots (`buildSlots`)

Add, grouped with each créneau (`required: false`, so retro-compatible):

```ts
{ id: "slot1_days", name: "Days", description: "Days of week (empty = every day)",
  type: "select", list: true, required: false, group: "slot1",
  options: WEEKDAY_OPTIONS },   // mon,tue,wed,thu,fri,sat,sun
```

`WEEKDAY_OPTIONS = [{value:"mon",label:"Mon"}, …, {value:"sun",label:"Sun"}]`.
Same for `slot2_days`, `slot3_days`.

### Weekday model + scheduler

- Token → JS `getDay()` map: `sun=0, mon=1, tue=2, wed=3, thu=4, fri=5, sat=6`.
- `parseDays(raw): Set<number>` — accepts a comma string or an array, maps known
  tokens to `getDay()` numbers, drops unknowns. **Empty set = every day.**
- `TimeSlot` gains `days: Set<number>` (empty = all).
- `msUntilTime(time, days, now = new Date()): number` — scan day offsets `0..7`; for
  each, build the target at `HH:MM` on that date; return the first target that is
  strictly in the future **and** whose `getDay()` is allowed (or any day when `days`
  is empty). This subsumes the old today/tomorrow logic.
- `findNextSlot(slots, now = new Date())` — unchanged shape, now day-aware via the new
  `msUntilTime`.
- `scheduleSlot` passes the slot's `days`; after a slot fires it reschedules, which
  naturally computes the next allowed weekday.
- Export `msUntilTime` / `findNextSlot` / `parseDays` for unit tests (or a small
  `__test` bundle) — they take an explicit `now`, so tests are deterministic.

Weekday uses process-local `getDay()`, consistent with the existing local-time
`msUntilTime` (Sowel sets `TZ=Europe/Paris`).

### Validation

`validate` is unchanged except: day tokens, if present, are tolerated (unknown tokens
ignored, never throw). No new required constraints.

### i18n

FR/EN labels for `slot{1,2,3}_days` (name "Jours" / "Days", description) and the 7
day options via `RecipeLangPack.slots[id].options`.

### Versioning / release (post-merge, separate step)

- Recipe: `package.json` + `manifest.json` `1.1.0 → 1.2.0`, `npm run build`, publish
  GitHub release with the `.tar.gz` asset, then `node scripts/backfill-registry-sha256.mjs`
  in the Sowel repo and commit `plugins/registry.json` (spec 089). Do **not** release
  Sowel just for the registry.
- Core UI multi-select ships with the next Sowel release. **Coordinate**: the recipe's
  new `select+list` slot only renders as chips on a core that has this change; on an
  older core it degrades to a single dropdown (still functional, one day at a time).
  Ship the core release at or before the recipe release.

## File changes

| Repo   | File                                               | Change                                                        |
| ------ | -------------------------------------------------- | ------------------------------------------------------------- |
| core   | `ui/src/components/recipes/ZoneRecipesSection.tsx` | Multi-select chip rendering for `select`+`list` (2 blocks)    |
| core   | `specs/130-watering-weekdays/*`                    | This spec                                                     |
| recipe | `src/index.ts`                                     | Mirrored types, `slotN_days` slots, day-aware scheduler, i18n |
| recipe | `src/index.test.ts`                                | Weekday scheduler tests                                       |
| recipe | `package.json`, `manifest.json`                    | Version bump (at release time)                                |
