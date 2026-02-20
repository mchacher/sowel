# Implementation Plan: V0.8 Recipe Engine + Motion-Light Recipe

## Tasks

1. [x] Types: add RecipeSlotDef, RecipeInfo, RecipeInstance, RecipeLogEntry, recipe events to types.ts
2. [x] Migration: create 005_recipes.sql (recipe_instances, recipe_state, recipe_log)
3. [x] Recipe base class: src/recipes/recipe.ts (abstract class + RecipeContext interface)
4. [x] RecipeStateStore: src/recipes/recipe-state-store.ts (SQLite key-value per instance)
5. [x] RecipeManager: src/recipes/recipe-manager.ts (registry, lifecycle, DB persistence, log)
6. [x] Motion-Light recipe: src/recipes/motion-light.ts
7. [x] API routes: src/api/routes/recipes.ts (CRUD + log)
8. [x] Wire up: server.ts (routes), websocket.ts (events), index.ts (init RecipeManager)
9. [x] Tests: recipe-manager.test.ts (9 tests), motion-light.test.ts (12 tests)
10. [x] TypeScript compile check (backend) — zero errors

## Dependencies

- Requires V0.6 (zone aggregation) — zone.aggregation.changed events
- Requires V0.3 (equipment manager) — executeOrder, equipment.data.changed events

## Additional Changes

- EventBus.on() and onType() now return unsubscribe functions (needed for recipe cleanup)
- RecipeManager uses constructor registration (each running instance gets its own Recipe object)

## Testing

### Unit tests (recipe-manager.test.ts) — 9 tests ✅
- Register a recipe, list recipes
- Get recipe by id
- Create instance with valid params → persisted in DB
- Create instance with invalid params → rejected
- Create instance for unknown recipe → rejected
- Delete instance → stopped and removed from DB
- Delete nonexistent instance → error
- Restore instances on init → all enabled instances started
- Log entries written and retrievable

### Unit tests (motion-light.test.ts) — 12 tests ✅
- Validates required params
- Validates zone exists
- Validates light has state order
- Motion true + light off → turn on
- Motion true + light on → reset timer (no action)
- Motion false + light on → start timer → turn off on expiry
- Motion re-detected before timer → timer cancelled
- Light turned on externally + no motion → start timer
- Light turned off externally → timer cancelled
- Zone has no motion sensors → warning logged
- Light equipment missing state order → error
- Stop cleans up (delete instance cancels timers)

### Manual verification
- Create a motion-light instance via API for a real zone/light
- Walk in front of PIR → light turns on
- Leave the room → light turns off after timeout
- Turn on light manually → light turns off after timeout if no motion
- Check execution log via API
