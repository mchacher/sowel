# Spec 154 — Implementation plan

## Data model

- [ ] `migrations/024_equipment_invert_direction.sql`:
      `ALTER TABLE equipments ADD COLUMN invert_direction INTEGER NOT NULL DEFAULT 0;`
      (mirrors 018; default 0 so existing rows are unaffected).
- [ ] `src/shared/types.ts`: add `invertDirection?: boolean` to `Equipment` (next to
      `requireConfirmation`).
- [ ] `ui/src/types.ts`: mirror `invertDirection?: boolean`.

## Backend — manager

- [ ] `EquipmentRow`: add `invert_direction: number`.
- [ ] `rowToEquipment`: `invertDirection: row.invert_direction === 1`.
- [ ] `create` upsert + `update` merge: accept and persist `invertDirection`
      (mirror `require_confirmation` at lines ~198, ~505, ~1514, ~1610).
- [ ] `executeOrder`: after fetching bindings, before `resolveOrderValue`, invert
      the semantic value when `equipment.invertDirection` and the order category is
      `shutter_move`/`pool_cover_move` (OPEN↔CLOSE, STOP unchanged) or
      `set_shutter_position`/`pool_cover_position` (number → 100−value).
- [ ] Read path: NONE — command-only. Reported position + zone aggregation stay raw.

## API

- [ ] `src/api/routes/equipments.ts`: add `invertDirection: { type: "boolean" }` to
      the create/update body schema and thread through (mirror `requireConfirmation`).

## UI

- [ ] Equipment edit form: add an "Invert open/close direction" toggle bound to
      `invertDirection`, rendered only for `shutter | awning | pool_cover`. Reuse the
      `requireConfirmation` toggle pattern.
- [ ] i18n: `equipments.invertDirection` label + helper in `en.json` / `fr.json`.

## Tests (mandatory)

- [ ] `equipment-manager.test.ts`: - inverted equipment: `executeOrder(shutter_move, "OPEN")` dispatches `CLOSE`
      to the device (and vice versa); `STOP` unchanged. - inverted equipment: `set_shutter_position` 30 dispatches 70. - flag off: dispatches the raw value (regression guard). - read path unchanged: an inverted equipment still reports its raw position.
- [ ] API round-trip: create/update with `invertDirection: true` persists and
      serializes.
- [ ] UI: the toggle renders only for shutter-family types and updates the field.

## Validation

- [ ] `npx tsc --noEmit`, `npx eslint src/ --ext .ts`, `npx vitest run`.
- [ ] `cd ui && npx tsc -b --noEmit && npx eslint . && npx vitest run`.
- [ ] Independent agent review (sowel-issue Phase 5).

## Manual / empirical verification

- [ ] Recipe/mode/zone-bulk driving an inverted equipment all move it the corrected
      way (component tests cover recipe forms per the shadow-disables-recipes note;
      the arbiter/zone command path is unit-tested).
- [ ] Toggle the flag in the edit form; confirm the position pill/slider flips.

## Docs / release

- [ ] Update the shutters/awning docs page to mention the invert option.
- [ ] Release notes entry (spec 108) in the next release, in both languages.

## Decisions (locked)

- Field/column: `invertDirection` / `invert_direction`.
- Scope: command-only (write path). No position-read or aggregation inversion.
