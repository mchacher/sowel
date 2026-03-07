# Implementation Plan: StateWatch Recipe

## Tasks

1. [ ] Create `src/recipes/state-watch.ts` with slots, validate, start, stop
2. [ ] Register in `src/index.ts`
3. [ ] Type-check + tests
4. [ ] Manual test: create instance, verify alarm triggers after delay, repeat works, checkTime works

## Testing

- `npx tsc --noEmit` (zero errors)
- `npm test` (all pass)
- Manual: create StateWatch instance for a door sensor, verify alarm after delay, verify repeat, verify scheduled check, verify alarm clears on value change
