# V0.8: Cocoon Mode for Presence Thermostat

## Summary

Add a "cocoon" temperature level to the presence-thermostat recipe, triggered by a physical button press. Cocoon provides a temporary comfort boost (e.g., 23°C) that follows the same presence logic as comfort — it exits on absence timeout or when night starts.

## Reference

- Recipe system: §12 of winch-spec.md
- Presence-thermostat recipe: `src/recipes/presence-thermostat.ts`
- Button action pattern: `src/recipes/switch-light.ts`

## Acceptance Criteria

- [ ] Two new optional slots: `buttons` (equipment list, type button) and `cocoonTemp` (number)
- [ ] Button press toggles cocoon mode on/off
- [ ] Cocoon sends `cocoonTemp` to thermostat
- [ ] No motion for `timeout` duration exits cocoon → eco (same timer as comfort)
- [ ] Night window start exits cocoon → eco
- [ ] Second button press exits cocoon → comfort (if motion) or eco (if no motion)
- [ ] Manual setpoint change during cocoon → override (existing behavior)
- [ ] Preheat does NOT prevent cocoon from exiting on absence
- [ ] Without buttons configured, recipe works exactly as before (backward compatible)
- [ ] `cocoonMode` and `currentMode: "cocoon"` exposed in recipe state for UI

## Scope

### In Scope

- Cocoon mode state machine within existing presence-thermostat recipe
- Button action subscription (same pattern as switch-light)
- Night window check exits cocoon via periodic timer
- i18n for new slots (fr/en)
- Tests for all cocoon scenarios

### Out of Scope

- Separate cocoon recipe (would conflict with presence-thermostat)
- Cocoon-specific timeout (uses existing `timeout` parameter)
- UI changes (state is already displayed via recipe state)

## Edge Cases

- Button press during override mode: ignored (override takes precedence)
- Button press during eco: enters cocoon directly from eco
- Cocoon during preheat window: cocoon takes precedence, absence still causes eco
- Recipe restart: cocoon state is lost (runtime only, same as comfort/eco)
