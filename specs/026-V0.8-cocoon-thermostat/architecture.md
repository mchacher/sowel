# Architecture: V0.8 Cocoon Mode for Presence Thermostat

## Data Model Changes

No database changes. No new types in types.ts.

The `currentMode` field in recipe state gains a new value: `"cocoon"` (alongside existing `"comfort"` and `"eco"`).

New state keys persisted in `recipe_state`:

- `cocoonMode: boolean` — whether cocoon is active
- `currentMode: "cocoon"` — when cocoon is the active mode

## Event Bus Events

**Consumed (existing):**

- `equipment.data.changed` — button "action" alias (new subscription)
- `zone.data.changed` — motion (existing subscription)
- `equipment.data.changed` — thermostat "setpoint" (existing subscription)

**No new events emitted.**

## State Machine

```
ECO ──motion──→ COMFORT ──timeout──→ ECO
 │                │
 │ button         │ button
 ↓                ↓
COCOON (cocoonTemp)
   │
   ├─ timeout without motion → ECO
   ├─ nightStart → ECO
   ├─ 2nd button press → COMFORT (motion) or ECO (no motion)
   └─ manual setpoint → OVERRIDE
```

## File Changes

| File                                      | Change                                                            |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `src/recipes/presence-thermostat.ts`      | Add slots, cocoon state machine, button subscription, night check |
| `src/recipes/presence-thermostat.test.ts` | Add ~10 cocoon test cases                                         |
| `ui/src/i18n/locales/fr.json`             | Add translations for buttons/cocoonTemp slots                     |
| `ui/src/i18n/locales/en.json`             | Add translations for buttons/cocoonTemp slots                     |
