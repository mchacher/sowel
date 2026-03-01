# Implementation Plan: V0.8 Cocoon Mode for Presence Thermostat

## Tasks

1. [ ] Add `buttons` and `cocoonTemp` slot definitions
2. [ ] Add i18n entries for new slots (fr)
3. [ ] Add instance fields: `buttonIds`, `cocoonTemp`
4. [ ] Add validation for buttons (has "action" binding) and cocoonTemp (paired)
5. [ ] Add button action subscription in `start()`
6. [ ] Extend `currentMode` type to include `"cocoon"`
7. [ ] Add `setCocoon()` method
8. [ ] Add `onButtonAction()` handler (toggle cocoon)
9. [ ] Modify `onZoneChanged()` to handle cocoon mode (presence logic)
10. [ ] Modify `setEco()`/`setComfort()` to clear cocoon state
11. [ ] Add night check for cocoon exit in periodic timer
12. [ ] Extend periodic timer start condition for cocoon+night
13. [ ] Clean cocoon state in `stop()`
14. [ ] Add i18n keys in en.json and fr.json
15. [ ] Write tests: validation, cocoon on/off, absence exit, night exit, override interaction, preheat interaction
16. [ ] TypeScript compile check
17. [ ] Run all tests

## Dependencies

- Requires presence-thermostat recipe (V0.8) — already implemented

## Testing

- Run `npx tsc --noEmit` — zero errors
- Run `npm test` — all tests pass
- Manual: create instance with buttons + cocoonTemp, press button → verify setpoint changes
