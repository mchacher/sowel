# V0.8: Recipe Engine + Motion-Light Recipe

## Summary

Introduce a code-driven Recipe engine that runs pre-built behavior patterns with user-supplied parameters. Recipes are TypeScript classes that subscribe to the Event Bus, manage internal state, and execute orders. They coexist with a future data-driven Scenario engine (V0.9).

The first recipe — **motion-light** — automatically turns a light on when motion is detected in a zone and off after a configurable timeout with no motion.

## Reference

- Spec sections: §5.5 (Recipe), §11 (Roadmap V0.8/V0.10)
- Jeedom scenario analysis (session 2026-02-20): complex kitchen light automation

## Design Decision: Code-driven vs Data-driven

Recipes are **code-driven** (TypeScript classes), not data-driven (JSON templates). Rationale:

- Complex behaviors (state machines, hysteresis, rolling averages) are trivial in code, nearly impossible in a JSON trigger/condition/action model
- Each recipe is a single isolated file — easy to test, easy to maintain
- Users don't edit recipe logic, they fill in typed parameters (slots)
- A separate data-driven Scenario engine (V0.9) handles simple user-created automations

## Acceptance Criteria

### Recipe Engine Framework

- [ ] Abstract `Recipe` base class with lifecycle (`start` / `stop`)
- [ ] `RecipeManager` loads all recipes, manages instances (create / start / stop / delete)
- [ ] `RecipeStateStore` provides key-value persistence per instance (SQLite)
- [ ] `RecipeContext` injected into recipes: eventBus, equipmentManager, zoneAggregator, logger, stateStore
- [ ] Recipe instances restored on engine restart (re-start all enabled instances)
- [ ] Execution log per instance (structured messages stored in SQLite)
- [ ] API endpoints: list recipes, list instances, create instance, delete instance, get instance log
- [ ] WebSocket events for recipe instance state changes

### Motion-Light Recipe

- [ ] Recipe ID: `motion-light`
- [ ] Slots: zone (zone), light (equipment, any light type), timeout (duration, default 10m)
- [ ] Motion detected in zone + light OFF → turn light ON
- [ ] Motion detected in zone + light ON → reset extinction timer
- [ ] Motion stops in zone + light ON → start extinction timer
- [ ] Timer expires → turn light OFF
- [ ] Light turned ON externally (manual, UI, API) → start monitoring, timer managed same as auto
- [ ] Light turned OFF externally → cancel timer, stop monitoring
- [ ] All decisions logged to execution log

## Scope

### In Scope

- Recipe engine framework (base class, manager, state store, context)
- SQLite tables: recipe_instances, recipe_state, recipe_log
- REST API for recipe management
- WebSocket events
- motion-light recipe implementation
- Unit tests for recipe engine and motion-light recipe

### Out of Scope

- UI for recipe management (deferred — API-only for now)
- Data-driven Scenario engine (V0.9)
- Advanced recipes (dimming, lux threshold, time-based brightness)
- InfluxDB / rolling average dependencies

## Edge Cases

- Zone has no motion sensors → recipe starts but never triggers (log warning on start)
- Light equipment deleted while recipe running → recipe detects missing equipment, logs error, auto-disables
- Zone deleted while recipe running → recipe detects missing zone, logs error, auto-disables
- Multiple recipe instances on same light → allowed (user responsibility), each manages its own timer
- Engine restart → all enabled instances re-started, timers lost (acceptable for V1 — timer is short-lived)
- MQTT disconnect → no events flow, recipe idle. On reconnect, state re-syncs naturally
- Light has no "state" order binding → recipe logs error on start, refuses to activate
