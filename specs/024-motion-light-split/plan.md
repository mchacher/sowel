# Implementation Plan: Motion Light Split

## Tasks

1. [ ] Create `src/recipes/engine/motion-light-base.ts` — abstract base class
2. [ ] Rewrite `src/recipes/motion-light.ts` — simple subclass
3. [ ] Create `src/recipes/motion-light-dimmable.ts` — dimmable subclass
4. [ ] Create `migrations/017_motion_light_split.sql` — migrate existing instances
5. [ ] Register `MotionLightDimmableRecipe` in `src/index.ts`
6. [ ] Add i18n keys for new recipe + daylight slot
7. [ ] Refactor `src/recipes/motion-light.test.ts` — simple recipe tests + daylight
8. [ ] Create `src/recipes/motion-light-dimmable.test.ts` — dimmable tests
9. [ ] Build + lint + test — zero errors

## Dependencies

- Requires sunrise/sunset feature (feat/sunrise-sunset) merged — DONE

## Testing

- All existing motion-light behaviors preserved across the two recipes
- Daylight disable: verify lights don't turn on when isDaylight=true
- Daylight transition: lights on → daylight starts → timeout → off → no re-on
- Migration: instances with brightness params get recipe_id updated
