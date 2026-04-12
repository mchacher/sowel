# Implementation Plan — Spec 063

## Strategy

Three workstreams, in order:

1. **A** — Sowel core: new `watering-schedule` slot type + UI component
2. **B** — Recipe plugin: `sowel-recipe-auto-watering` repo creation + logic
3. **C** — Integration: registry, release, end-to-end testing

## Slice A — Sowel core (this repo)

### A.1 — Add `watering-schedule` slot type

**`src/shared/types.ts`** — add `"watering-schedule"` to RecipeSlotDef.type union
**`ui/src/types.ts`** — mirror the change

### A.2 — WateringScheduleEditor component

**`ui/src/components/recipes/WateringScheduleEditor.tsx`** (NEW)

- Renders the schedule editor (slot cards with time + per-valve durations)
- Props: `value` (JSON string), `onChange`, `valveIds`, `equipments`
- Internal state: parsed schedule array
- "Add slot" creates a new entry with default time and default durations (10 min per valve)
- "Remove slot" removes the entry
- Time input: native `<input type="time">`
- Duration inputs: number inputs per valve, resolved from `valveIds`
- Serializes back to JSON string on every change

### A.3 — Integrate in ZoneRecipesSection

**`ui/src/components/recipes/ZoneRecipesSection.tsx`**

- Import `WateringScheduleEditor`
- Add rendering case for `slot.type === "watering-schedule"`
- Resolve valve IDs from the `valves` slot param
- Pass equipments for name resolution

### A.4 — Validate slice A

```bash
npx tsc --noEmit
cd ui && npx tsc -b --noEmit && npx eslint .
```

---

## Slice B — Recipe plugin (new repo)

### B.1 — Create repo `sowel-recipe-auto-watering`

- `manifest.json`: id "auto-watering", type "recipe", version "1.0.0"
- `package.json`: minimal deps (TypeScript only)
- `tsconfig.json`: same config as other recipe plugins
- `.github/workflows/release.yml`: same release workflow as other recipes

### B.2 — Implement `src/index.ts`

**`createRecipe()`** factory returning `RecipeDefinition`:

1. **Slots definition** — zone, valves, schedule, weatherStation, rainThreshold, useRainForecast
2. **i18n** — French translations for all slots, groups, descriptions
3. **`validate(params, ctx)`**:
   - Check zone exists
   - Check at least 1 valve selected and all exist
   - Check schedule is valid JSON array with at least 1 entry
   - Each entry has valid time (HH:MM) and durations for all selected valves
   - If weatherStation set, check rainThreshold is set and valid
4. **`createInstance(params, ctx)`**:
   - Parse params (valves list, schedule, weather config)
   - Compute next trigger times
   - Set timers for each slot
   - Set initial state (idle, next slot)
   - Return `{ stop() }` handle

**Scheduling logic:**

```typescript
function scheduleNextTrigger(slot, ctx) {
  const now = new Date();
  const [h, m] = slot.time.split(":").map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);

  // If time already passed today, schedule for tomorrow
  if (target <= now) target.setDate(target.getDate() + 1);

  const delay = target.getTime() - now.getTime();
  return setTimeout(() => triggerSlot(slot, ctx), delay);
}
```

**Trigger logic:**

```typescript
async function triggerSlot(slot, ctx, params) {
  ctx.log(`Créneau ${slot.time} — évaluation des conditions`);

  // Rain check
  if (params.weatherStation) {
    const eq = ctx.equipmentManager.getByIdWithDetails(params.weatherStation);
    const rain24h = eq?.computedData?.find((c) => c.alias === "rain_24h");
    if (rain24h?.value > Number(params.rainThreshold)) {
      ctx.log(
        `Créneau ${slot.time} skippé — rain_24h = ${rain24h.value} mm (seuil: ${params.rainThreshold} mm)`,
      );
      ctx.state.set("status", "skipped");
      ctx.state.set("lastSkipReason", `rain ${rain24h.value}mm`);
      scheduleNextTrigger(slot, ctx); // reschedule for tomorrow
      return;
    }
  }

  // Forecast check
  if (params.useRainForecast === "true") {
    // Auto-detect weather_forecast equipment
    const allEq = ctx.equipmentManager.getAllWithDetails();
    const forecast = allEq.find((e) => e.type === "weather_forecast");
    if (forecast) {
      const prob = forecast.dataBindings.find((b) => b.alias === "j1_rain_prob");
      if (prob && typeof prob.value === "number" && prob.value > 75) {
        ctx.log(`Créneau ${slot.time} skippé — probabilité pluie J+1 = ${prob.value}%`);
        ctx.state.set("status", "skipped");
        ctx.state.set("lastSkipReason", `prévision ${prob.value}%`);
        scheduleNextTrigger(slot, ctx);
        return;
      }
    }
  }

  // Open valves
  ctx.state.set("status", "watering");
  ctx.state.set("currentSlot", slot.time);

  const valveIds = params.valves.split(",");
  let maxDuration = 0;

  for (const valveId of valveIds) {
    const duration = slot.durations[valveId] ?? 10;
    maxDuration = Math.max(maxDuration, duration);
    const eq = ctx.equipmentManager.getById(valveId);
    const valveName = eq?.name ?? valveId;

    try {
      await ctx.equipmentManager.executeOrder(valveId, "state", {
        state: "ON",
        on_time: duration * 60,
      });
      ctx.log(`${valveName} ouverte pour ${duration} min`);
    } catch (err) {
      ctx.log(`Erreur ouverture ${valveName}: ${err.message}`, "error");
    }
  }

  // Schedule completion
  setTimeout(
    () => {
      ctx.state.set("status", "idle");
      ctx.state.set("currentSlot", null);
      ctx.log(`Arrosage créneau ${slot.time} terminé`);
    },
    maxDuration * 60 * 1000,
  );

  // Schedule next trigger (tomorrow)
  scheduleNextTrigger(slot, ctx);
}
```

### B.3 — Build and test locally

```bash
npm run build
# Copy dist to Sowel plugins/ for local testing
cp -r dist /path/to/Sowel/plugins/auto-watering/dist
cp manifest.json package.json /path/to/Sowel/plugins/auto-watering/
```

### B.4 — Test with real device

1. Create recipe instance on the Jardin zone
2. Select Vanne Gazon
3. Add 1 slot at a time 2 minutes from now
4. Verify valve opens for the configured duration
5. Verify valve closes automatically (on_time)
6. Verify log entries appear
7. Verify state pill updates
8. Test rain skip: set threshold to 0 mm, verify slot is skipped

---

## Slice C — Integration

### C.1 — Publish recipe plugin

```bash
git push origin main
git tag v1.0.0
git push origin v1.0.0
# GitHub Actions builds and creates release
```

### C.2 — Update registry

**`plugins/registry.json`** — add auto-watering entry:

```json
{
  "id": "auto-watering",
  "type": "recipe",
  "name": "Arrosage Auto",
  "description": "Arrosage programmé avec gestion intelligente de la pluie",
  "icon": "Droplets",
  "author": "mchacher",
  "repo": "mchacher/sowel-recipe-auto-watering",
  "version": "1.0.0",
  "tags": ["watering", "irrigation", "garden", "rain"]
}
```

### C.3 — Update specs-index

**`docs/specs-index.md`** — add spec 063 entry.

### C.4 — End-to-end validation on local dev

1. Install recipe via PackageManager (or manual copy)
2. Create instance on Jardin zone with Vanne Gazon
3. Verify full flow: schedule → trigger → rain check → valve open → auto-close → log → state
4. Verify UI: pills on zone page, schedule editor, edit form

---

## Validation Plan

### Automated checks (Sowel core)

```bash
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run
cd ui && npx tsc -b --noEmit && npx eslint .
```

### Manual test plan

1. Create recipe instance with 1 valve, 1 slot → valve opens at scheduled time
2. Create instance with 2 valves, 2 slots → both valves open simultaneously, both slots fire
3. Set rain threshold to 0 mm → slot skipped with correct log message
4. Enable forecast with real j1_rain_prob > 75% → slot skipped
5. Disable recipe → timers cleared, state idle
6. Restart Sowel → instance restored, timers rescheduled
7. Valve offline → error logged, other valves still open

---

## Risks & Mitigations

| Risk                                             | Mitigation                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Timer drift after long uptime                    | Use absolute time calculation, not relative delays. Recalculate on each trigger. |
| Sowel restart during watering                    | on_time is device-side — valve closes itself. Recipe resets to idle.             |
| Schedule editor complexity in existing recipe UI | Dedicated component `WateringScheduleEditor`, isolated from generic slot logic   |
| JSON schedule param validation                   | Strict validation in `validate()` with clear error messages                      |

## Out of Scope

- Soil moisture sensor
- Duration adjustment by temperature/wind
- Sequential valve operation
- Manual actions (water now, skip next)
- Notifications (handled by notification system)
