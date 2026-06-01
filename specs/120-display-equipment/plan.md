# Plan — Spec 120 — Display equipment type

One branch on Sowel core: `feat/display-equipment`. Single PR.

The companion plugin (`sowel-plugin-energy-display`) ships from its own
repo under a separate spec and is **not** required for this PR to merge
— Sowel UI gracefully degrades to "no displays bound yet".

---

## A1 — Types and constants

- [ ] `src/shared/types.ts`: extend `DataCategory` with the 5 new
      values (`firmware_version`, `uptime`, `rssi`, `language`,
      `display_brightness`) — keep `generic` last as the catch-all.
- [ ] `src/shared/types.ts`: extend `OrderCategory` with `set_language` + `set_display_brightness`.
- [ ] `src/shared/types.ts`: extend `EquipmentType` with `display`.
- [ ] `src/shared/types.ts`: extend `WidgetFamily` with `displays`.
- [ ] `src/shared/types.ts`: extend `ZoneAggregatedData` with
      `displaysOnline` + `displaysTotal`.
- [ ] `src/shared/constants.ts`: add `displays: ["display"]` to
      `WIDGET_FAMILY_TYPES`.

## A2 — Backend — equipment manager + binding candidates

- [ ] `src/equipments/equipment-manager.ts`: add `"display"` to
      `VALID_EQUIPMENT_TYPES`.
- [ ] `src/equipments/binding-candidates.ts`: in the
      `equipment.type === "display"` branch, propose data of the 5
      new categories.
- [ ] No `ZONE_COMMANDS` entry for display (see D5 in architecture.md).

## A3 — Backend — zone aggregation

- [ ] `src/zones/zone-aggregator.ts`: extend the accumulator with
      `displaysOnline` + `displaysTotal` (init 0).
- [ ] `src/zones/zone-aggregator.ts`: in the per-equipment walk,
      branch on `equipment.type === "display"` — bump `displaysTotal`,
      bump `displaysOnline` when the equipment's status is `"online"`.
- [ ] `src/zones/zone-aggregator.ts`: update `aggregatedDataEqual` +
      public projection to include the 2 new fields.

## A4 — Backend tests

- [ ] `src/equipments/equipment-manager.test.ts`:
  - create({ type: "display" }) succeeds.
  - create({ type: "displai" }) throws with a clear message.
- [ ] `src/equipments/binding-candidates.test.ts`:
  - a `display` equipment with devices exposing
    `firmware_version` / `uptime` / `rssi` / `language` /
    `display_brightness` sees all 5 in the candidate list.
  - a `light_dimmable` equipment does NOT see the 5 new categories.
- [ ] `src/zones/zone-aggregator.test.ts`:
  - 2 displays, 1 online + 1 offline → `displaysOnline = 1`,
    `displaysTotal = 2`.
  - 0 displays in a zone → both counters = 0.
  - Nested zones bubble the counters up correctly.
- [ ] `src/api/routes/equipments.test.ts`:
  - POST `type: "display"` returns 201 with the new equipment.
  - POST `type: "displaaay"` returns 400.

## B1 — UI — dashboard family card

- [ ] `ui/src/components/dashboard/widgets/DisplaysWidget.tsx` (new):
      list of bound displays, one row each with an online dot, name,
      last-seen, firmware version. Mirrors the layout of
      `WeatherWidget.tsx` for consistency.
- [ ] `ui/src/components/dashboard/Dashboard.tsx`: register
      `displays` in the family list.

## B2 — UI — zone compact card

- [ ] `ui/src/components/zones/cards/DisplayCompactCard.tsx` (new):
      one row per display in the zone. Online dot + name + brightness
      slider (rendered iff a `display_brightness` binding exists AND a
      `set_display_brightness` order is available). Tiny enough that
      the zone view does not blow up vertically.
- [ ] `ui/src/components/zones/ZoneCardRenderer.tsx`: route
      `display` to the new compact card.

## B3 — UI — equipment detail card

- [ ] `ui/src/components/equipments/cards/DisplayDetailCard.tsx` (new):
      rows for firmware / uptime / RSSI / IP (if exposed by the plugin)
      / language / brightness. Each row hides itself when the
      corresponding binding is missing. Orders rendered when the matching
      `DeviceOrder` exists on the bound device.
- [ ] `ui/src/components/equipments/EquipmentDetailRenderer.tsx`:
      route `display` to the new detail card.

## B4 — UI — add-equipment modal + i18n

- [ ] `ui/src/components/equipments/AddEquipmentModal.tsx`: add
      `display` to the type picker with a Lucide icon (`Tv` or
      `MonitorSmartphone` — final pick in the implementation PR).
- [ ] `ui/src/i18n/fr.json` + `ui/src/i18n/en.json`: keys for
  - equipment type display name + description
  - family card title
  - state field labels (firmware, uptime, rssi, language, brightness)
  - order labels (set language, set brightness)

## B5 — UI — manual smoke tests

These are the manual checks that go in the PR test plan; they are
documented here so the implementor does not re-discover them.

- [ ] Create a `display` equipment via the modal — appears in the
      zone view, with no data rows (no bindings yet).
- [ ] Bind manually to a fake MQTT device exposing the 5 categories —
      every row appears.
- [ ] Drop the `language` binding — language row disappears, the
      rest stay.
- [ ] Mark the device offline in the plugin admin — equipment status
      flips to `offline`, dashboard family card dims the row.
- [ ] Send a `set_display_brightness` order from the slider — the
      request hits the order route (verify via network panel).

## Test plan (cross-cutting)

### Modules to test

| Module               | Scenarios                                                            |
| -------------------- | -------------------------------------------------------------------- |
| `equipment-manager`  | Create `display`; reject typo                                        |
| `binding-candidates` | Propose 5 categories for `display`; don't propose for other types    |
| `zone-aggregator`    | `displaysOnline / Total` in flat + nested zones, with mixed statuses |
| `routes/equipments`  | API happy + reject paths                                             |

### What NOT to test

- The plugin: separate repo / spec.
- The display firmware: separate repo / spec.
- UI components: project convention skips React unit tests (CLAUDE.md).

---

## Phase 4 validation

Before opening the PR:

```bash
npx tsc --noEmit                                                # backend
cd ui && npx tsc -b --noEmit                                    # frontend
cd /Users/mchacher/Documents/01_Geekerie/Sowel && npx vitest run
npx eslint src/ --ext .ts
```

ZERO TS errors, ZERO ESLint errors, ALL vitest tests green.

## Phase 5 — commit + PR

- Conventional commit: `feat(equipments): add display equipment type (spec 120)`.
- PR body: short summary + link to `specs/120-display-equipment/spec.md` +
  the manual smoke list from B5 as a checklist.
- No `Co-Authored-By` line.

## Phase 6 — merge gate

Wait for explicit user OK before `gh pr merge`.

## Follow-ups (out of this spec, tracked separately)

1. `sowel-plugin-energy-display` repo creation + first release.
2. `sowel-energy-display` iter 035 (MQTT supervision firmware).
3. Registry entry PR on this repo after the plugin tags v0.1.0.
4. Future: "displays" recipe family ("turn off all displays at 22h").
