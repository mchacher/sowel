# Spec 188 — Architecture

## Data model

- `src/shared/types.ts`
  - `OrderReceiptStatus` union (R1).
  - Engine events `device.order.receipt` and `equipment.order.receipt`.
- `migrations/037_shared_access_receipt.sql`
  - `ALTER TABLE shared_access_journal ADD COLUMN receipt TEXT;` NULL = no receipt expected.

## Event flow

```
plugin.executeOrder ──emit──▶ device.order.receipt{pending}
        │                              │
        ▼                              ▼
  MQTT /set + #id            OrderReceiptTracker (new)
        ⋮                     ├─ correlate (deviceId, orderKey) → last dispatched order
  /receipt from bridge        ├─ emit equipment.order.receipt ──▶ WS broadcast ──▶ UI store
        │                     ├─ raise / resolve alarm order-receipt:<eq>:<alias>
        ▼                     └─ shared-access hook → journal.receipt
plugin ──emit──▶ device.order.receipt{delivered|…}
```

## Files

| File                                                                                        | Change                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                                                                       | statuses, two events                                                                                                                                    |
| `src/plugins/scoped-deps.ts`                                                                | allow `device.order.receipt`; reject a foreign `integrationId`                                                                                          |
| `src/equipments/order-receipt-tracker.ts` (new)                                             | correlation table, alarm, re-emit                                                                                                                       |
| `src/equipments/equipment-manager.ts`                                                       | record each dispatch `(deviceId, orderKey) → {equipmentId, alias, value, source, at}` for the tracker, in `dispatchToBinding` before calling the plugin |
| `src/shared-access/shared-access-manager.ts`                                                | journal row id kept for the press; `open()` returns `receipt`; listener updates `receipt`                                                               |
| `src/shared-access/shared-access-store.ts`                                                  | `setReceipt(rowId, status)`, `receipt` in press rows                                                                                                    |
| `src/shared-access/guest-page.ts`                                                           | follow-up polling and the four outcomes (R5)                                                                                                            |
| `src/api/websocket.ts`                                                                      | broadcast `equipment.order.receipt`                                                                                                                     |
| `ui/src/store/`                                                                             | `lastReceipt` per equipment                                                                                                                             |
| `ui/src/components/dashboard/EquipmentWidget.tsx`, `MobileWidgetCard.tsx`, equipment detail | status line (R4)                                                                                                                                        |
| `ui/src/components/shared-access/`                                                          | receipt next to `opened` journal rows                                                                                                                   |
| `ui/src/i18n/locales/{en,fr}.json`                                                          | strings                                                                                                                                                 |
| `docs/user/shared-access{,.fr}.md`, `docs/technical/…`                                      | documentation                                                                                                                                           |

The plugin change lives in `mchacher/sowel-plugin-lora2mqtt` (one PR there).

## API

- `POST /p/…/api/open` (guest): response gains `receipt?: "pending"`.
- Guest `session.presses[]`: each gains `receipt?: OrderReceiptStatus`.
- Admin journal endpoint: rows gain `receipt`.
- No new route.
