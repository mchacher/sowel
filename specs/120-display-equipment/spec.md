# Spec 120 — Display equipment type

## Context

Sowel has no model for energy displays today. The `sowel-energy-display`
firmware (Waveshare AMOLED 1.75, iter 030+) is a self-contained client
that polls Sowel's REST API — Sowel cannot see it, name it, push config
to it, or include it in scenarios.

We are adding a `display` equipment type so any Sowel-supervised display
(starting with the AMOLED firmware, later e-paper / ePOS / others) shows
up as a first-class entity. Wire-protocol of choice is MQTT supervision
(LWT + retained state + cmd topics), mirroring the existing
`somfyrts2mqtt` / `zigbee2mqtt` / `lora2mqtt` pattern: any vendor that
publishes to the agreed topic structure is auto-discovered by a
companion plugin.

This spec covers **Sowel core only**:

- New equipment type, data categories, order categories.
- New widget family + UI surfaces.
- Zone aggregation.

The companion plugin (`sowel-plugin-energy-display`) and the firmware
work (sowel-energy-display iter 035) live in their own repos and ship
under their own specs once this contract is frozen.

## Goals

1. Introduce a new `display` equipment type — sibling to `weather`,
   `energy_meter`, etc. — observable in the dashboard, the zone view,
   and the equipment detail page.
2. Introduce 5 new `DataCategory` values that describe a display's
   self-reported state: `firmware_version`, `uptime`, `rssi`,
   `language`, `display_brightness`.
3. Introduce 2 new `OrderCategory` values for actuation:
   `set_language`, `set_display_brightness`.
4. New widget family `displays`, ship the three UI cards expected of a
   first-class equipment (dashboard family card, zone compact card,
   equipment detail card).
5. Aggregate `displaysOnline / displaysTotal` per zone so the zone
   widget can render "1/2 online" alongside the other family counts.
6. Online / offline status uses the existing `EquipmentStatus`
   derivation (spec 116) — the plugin marks the underlying `Device`
   offline when MQTT LWT fires, and Sowel cascades that to the
   equipment for free.
7. **Polymorphism** — none of the data fields or orders are mandatory.
   A passive single-screen display that only reports
   `firmware_version` + `uptime` is a valid Sowel display, fully
   observable; the UI hides any field / order that the bound device
   does not expose.

## Non-Goals

- The MQTT topic structure, JSON shape, and broker-side details
  (`sowel-display/<id>/availability` etc.) — owned by the companion
  plugin spec; this spec stays plugin-agnostic on purpose. Any
  integration that emits the right categories binds to a `display`.
- The companion plugin itself (`sowel-plugin-energy-display`,
  separate repo).
- The firmware-side implementation (sowel-energy-display iter 035,
  separate repo).
- `set_screen` / "switch screen" order. Confirmed with the user:
  which screen the display is showing is **internal** to the
  display's UX, not a Sowel concern. Displays may still expose
  vendor-specific orders for it but Sowel does not standardise a
  category.
- OTA push from Sowel to the display — future iter once the equipment
  ships and we know what we want to model.
- A "displays" recipe family (e.g. "turn off all displays at 22h").
  Recipes can be added once displays are visible and orderable; this
  spec ships only the equipment.
- Touching existing equipment types, recipes, or zone behaviour —
  additive only.

## Acceptance criteria

### API

- [ ] `POST /api/v1/equipments` with `{ type: "display", name, zoneId }`
      succeeds and returns an `Equipment` with `type === "display"`.
- [ ] `POST /api/v1/equipments` with `type: "displays"` (typo) returns
      400 with a clear message.
- [ ] Bindings to a device data of category `firmware_version`,
      `uptime`, `rssi`, `language`, `display_brightness` succeed and
      surface via `/api/v1/equipments/:id`.
- [ ] `POST /api/v1/equipments/:id/orders` with
      `category: "set_display_brightness"` and a 0..100 value
      dispatches through the existing plugin order path.

### Backend logic

- [ ] `equipment-manager` accepts `display` in `VALID_EQUIPMENT_TYPES`
      and rejects unknown types as before.
- [ ] `binding-candidates` proposes the 5 new categories when binding
      to a `display`.
- [ ] `zone-aggregator` counts `displaysOnline` (where
      `EquipmentStatus === "online"`) and `displaysTotal` in every
      zone subtree.

### UI

- [ ] Dashboard "Displays" family card lists every display with an
      online dot, name, last-seen, firmware version.
- [ ] Zone compact card row renders one line per display with the
      online dot + name + brightness slider (if the binding exists).
- [ ] Equipment detail card renders firmware / uptime / RSSI /
      language / brightness when bound, hides each row if unbound,
      and exposes the language dropdown + brightness slider when the
      matching orders are available on the device.
- [ ] All new strings localised (FR + EN).

### Tests

- [ ] `equipment-manager.test.ts` covers create + reject paths.
- [ ] `zone-aggregator.test.ts` covers `displaysOnline / displaysTotal`
      across nested zones, including mixed online/offline devices.
- [ ] `binding-candidates.test.ts` covers the new categories.

## Edge cases

- **Display with no language binding** — UI shows "—" in the language
  row; the dropdown is hidden because there is no `set_language`
  order on the device.
- **Display reports `display_brightness` but no `set_display_brightness`
  order** — slider is rendered read-only (greyed thumb), value shown
  but not editable.
- **Multiple displays in the same zone** — compact card renders one
  row per display, ordered by `Equipment.createdAt`. Family card
  count = sum across all zones.
- **Display offline (no MQTT activity)** — `EquipmentStatus` falls to
  `offline` (spec 116); detail card grays out the bar and shows
  "Offline since X" using the existing offline overlay.
- **Display brightness command issued while offline** — the order
  request still resolves on the API side (status `pending`); the
  plugin queues / discards per its own contract. Sowel does not
  block the request locally — consistent with how lights / shutters
  behave today.
- **Display with only the mandatory fields (`firmware_version`,
  `uptime`)** — detail card shows just those two rows; everything
  else hides. Validates the polymorphism goal.
