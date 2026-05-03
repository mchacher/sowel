# Spec 090 — MQTT mapping enable/disable

## Summary

Allow each MQTT publisher mapping to be individually enabled or disabled, in addition to
the existing publisher-level toggle. A disabled mapping stops publishing (live + initial
snapshot + manual test) but stays in the configuration so the user can re-enable it
without losing the source/key wiring.

## Why

Today the only way to silence a single mapping is to delete it. When a source is
temporarily inactive (e.g. seasonal equipment such as a stove in summer), users want to
keep the mapping configured but stop pushing values to the broker.

## Scope

In:

- New per-mapping `enabled` flag, default `true` for new and existing mappings.
- UI toggle (power-off icon next to the pencil) that flips the flag.
- Visual: disabled rows shown with reduced opacity.
- Runtime: disabled mappings are skipped in live publishing, initial snapshot, and the
  manual "Test" button.
- API: `enabled` accepted on POST and PUT mapping endpoints.

Out:

- No retain-clearing message is sent when a mapping is disabled. Whatever was last
  retained on the broker stays until the user clears it elsewhere.
- No bulk enable/disable across mappings.

## Acceptance criteria

- [x] New `enabled` column on `mqtt_publisher_mappings`, default 1, applied to existing rows.
- [x] `MqttPublisherMapping` type carries `enabled: boolean`.
- [x] `addMapping` defaults `enabled` to `true` when omitted.
- [x] `updateMapping` accepts `enabled?: boolean`.
- [x] `MqttPublishService` skips disabled mappings in:
  - live event handling (equipment / zone / recipe data changes),
  - `publishInitialSnapshot` and `publishInitialSnapshotForBroker`,
  - `publishSnapshotForPublisher` (Test button).
- [x] UI: each mapping row has a power-off / power-on icon button between pencil and trash.
- [x] UI: disabled rows render with reduced opacity (~ `opacity-50`).
- [x] Toggling sends `PUT /mqtt-publishers/:id/mappings/:mappingId { enabled }` and refreshes.

## Edge cases

- Disabling a mapping does **not** publish a tombstone / empty payload. Retained values
  on the broker remain until the user clears them out-of-band.
- The publisher-level `enabled` flag still wins: if the publisher is off, all its
  mappings are off regardless of their per-mapping flag.
- Migrating an existing DB sets every existing mapping to `enabled = 1`.
