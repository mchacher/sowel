# Spec 156 — Implementation plan

## Step 1 — Shared contracts

- `src/shared/types.ts`: `EquipmentType` += `ups`; `DataCategory` += `ups_status`,
  `battery_runtime`, `ups_load`; `WidgetFamily` += `power`.
- `src/shared/constants.ts`: `UPS_STATUS_VALUES`; `CATEGORY_EXPECTED_TYPE` for the
  two numeric categories; `WIDGET_FAMILY_TYPES.power = ["ups"]`;
  `STREAMING_CATEGORIES` += the three, with a staleness window sized for a slow poll.
- `ui/src/types.ts`: mirror.

## Step 2 — Binding

- `src/shared/binding-candidates.ts`: add `case "ups"` to the multi-value branch.
- `ui/src/components/equipments/bindingUtils.ts`: `RELEVANT_DATA.ups`,
  `RELEVANT_ORDERS.ups = []`.

## Step 3 — Backend acceptance

- `src/equipments/equipment-manager.ts`: `VALID_EQUIPMENT_TYPES` += `ups`.
- Tests: creation, candidate shape, and the submeter non-enrolment regression.

## Step 4 — UI primitives

- `upsStatus.ts`: `upsSeverityOf(status)`, `upsStatusKey(status)`,
  `formatRuntime(seconds)`. Unit-tested, no React import.

## Step 5 — UI surfaces

Type picker → card → compact card → zone group → dashboard widget → mobile card
→ detail sheet → detail panel, then EN/FR i18n. Each surface renders only the
bindings present.

## Step 6 — Docs

- `docs/specs-index.md`: row 156.
- `docs/technical/data-model/equipments.md`: the type and its categories.
- Release notes are added by the release that ships it, not by this PR.

## Verification

`npm run validate` (backend + UI typecheck, lint, tests), then a live check
against a real UPS through `sowel-plugin-nut`.
