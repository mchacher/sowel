# Spec 141: Order Delivery Confirmation

**Status**: Draft
**Issue**: #398
**Depends on**: spec 116 (equipment/device status), spec 101 (activity), notification pipeline

## Problem

`executeOrder` succeeding means the order reached the integration, not the device. On 2026-08-10 the pool pump schedule dispatched its end-of-slot OFF while the Tasmota relay was in a 104-second offline window: the MQTT command was published to a non-retained topic, the device never received it, Sowel logged `Equipment order executed`, and the pump ran 15.5 hours until manual intervention. The same class of failure exists for devices that acknowledge nothing (Tuya valves silently rejecting `on_time`) and for any integration where transport success does not imply device action.

Nothing in the engine notices, corrects, or tells the user.

## Goals

1. Detect when an order's effect is not observed on the equipment within a bounded delay.
2. Surface that to the user: a visible alarm in the UI and a push notification through the existing notification channels.
3. Heal the common transient case automatically: re-assert the last unconfirmed order once when the target device comes back online, within a bounded window.

## Non-goals

- No persisted order queue: pending orders live in memory and do not survive a restart (a restart during the 30 s window loses the watchdog, accepted for v1).
- No arbitration or desired-state store (spec 140 territory).
- No per-order opt-in UI: confirmability is derived automatically (see below).

## Functional design

### What is confirmable

An order on alias `A` of equipment `E` is **confirmable** when `E` has a data binding with the same alias `A`, and the ordered value is comparable to that binding's vocabulary:

- boolean-like values (`ON`/`OFF`, `true`/`false`, `on`/`off`) are always comparable
- numeric values (setpoints, brightness) are compared numerically
- enum values are comparable when the ordered value is one of the data binding's `enumValues` (case-insensitive)

Everything else is exempt: orders with no mirror data binding (scenes, stateless IR blasts, cover `STOP`) and enum orders whose vocabulary differs from the state vocabulary (cover `CLOSE` order vs `CLOSED` state). Exemption means no watchdog and no alarm, identical to today's behavior.

### Watchdog

On every confirmable `equipment.order.executed`:

1. If the equipment's mirror binding already reports the ordered value, the order is confirmed immediately.
2. If every device behind the order bindings is offline, the order is marked **unconfirmed** immediately with reason `device_offline` (no point waiting).
3. Otherwise a watchdog timer is armed: 30 s, stretched to **twice the poll interval** when a target device belongs to a polling integration (its mirror binding cannot move before the next poll; a fixed 30 s would false-alarm on every order to a cloud device). If no `equipment.data.changed` reports the ordered value before it fires, the order is marked **unconfirmed** with reason `timeout`.

A new order on the same `(equipment, alias)` supersedes the pending one (its alarm, if raised, is resolved).

### Surfacing

Marking an order unconfirmed:

- emits a new `equipment.order.unconfirmed` engine event (equipmentId, orderAlias, value, reason, source)
- raises `system.alarm.raised` with `alarmId = order-unconfirmed:<equipmentId>:<alias>`, level `warning`, and a human message naming the equipment, the ordered value, and the reason
- the existing notification pipeline already forwards system alarms to Telegram/ntfy/FCM/web push, so the user gets a push notification with no additional wiring

The alarm resolves (`system.alarm.resolved`) when a later state report finally matches the ordered value, or when a newer order supersedes it.

### Reconnect re-dispatch

When a device comes back online (`device.status_changed` to `online`), every unconfirmed order bound to that device that is less than 1 hour old and has not been retried yet is re-dispatched **once**, with `OrderSource {kind: "external", channel: "delivery-retry"}` so the journal shows who acted. The re-dispatch re-arms the watchdog; confirmation then resolves the alarm.

One retry, bounded at 1 hour, is deliberate: it heals the incident case (device back 14 s after the missed OFF) without surprise actuations long after the intent expired, and without fighting a device that keeps refusing.

### Timeline of the 2026-08-10 incident with this spec

| Time     | Behavior                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------- |
| 17:04:00 | OFF dispatched, devices offline: `unconfirmed(device_offline)` immediately, alarm raised, push sent |
| 17:04:14 | Device back online: OFF re-dispatched once                                                          |
| 17:04:16 | Device reports OFF: confirmed, alarm resolved, push sent                                            |

Total wrong-state time: 16 seconds instead of 15.5 hours, and the user was told.

## Defaults

| Parameter            | Value                        | Rationale                                                                                                                                                                   |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmation timeout | max(30 s, 2 x poll interval) | MQTT devices report within seconds; polling integrations (Panasonic, MCZ, ...) reflect the effect only on their next poll, so the watchdog stretches via `getPollingInfo()` |
| Re-dispatch TTL      | 1 h                          | Heals transients, avoids stale intent                                                                                                                                       |
| Re-dispatch count    | 1                            | No fighting, no loops                                                                                                                                                       |
| Alarm level          | warning                      | Self-recoverable degradation per the log-level policy                                                                                                                       |

Constants in v1; settings keys can come later if real installations need tuning.
