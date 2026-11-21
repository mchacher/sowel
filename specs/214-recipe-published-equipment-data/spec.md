# Spec 214 — A recipe publishes data on an equipment

**Status**: Draft 2026-11-21.

## Context

The washing machine on the maintainer's instance (`Lave-linge`, type `appliance`) gets its run
state from the SmartThings plugin, whose API goes behind a paid plan around 2026-12-15. The
machine is already metered by a SONOFF S60ZBTPF plug. Five cycles recorded on the plug
(2026-11-11 → 11-21) show that power alone tells the cycle:

| Start (local) | Length | Energy   | Heating | Longest stretch < 10 W mid-cycle |
| ------------- | ------ | -------- | ------- | -------------------------------- |
| 11-11 14:12   | 83 min | 1.05 kWh | 31 min  | 100 s                            |
| 11-13 07:28   | 72 min | 0.32 kWh | 7 min   | 38 s                             |
| 11-13 12:13   | 70 min | 0.36 kWh | 8 min   | 38 s                             |
| 11-15 16:01   | 66 min | 0.34 kWh | 8 min   | 46 s                             |

Off reads 0 W, an idle display about 6 W; a cycle never drops below about 5 W; the machine
switches itself off 160 s to 5 min after its end.

A first answer (spec 213, PR #1271) put that state machine in the core, with thresholds on the
equipment and a migration. It was merged, then reverted before any release (PR #1272): the
maintainer placed the line elsewhere.

- **The business logic belongs to a recipe.** When a washing machine is running, when its cycle
  is over and how it switches itself off are heuristics about one kind of machine. Recipes are
  where Sowel keeps that kind of logic: versioned in their own repository, set by parameters,
  replaceable without a core release.
- **The finer state belongs to the equipment.** The panel, the cards, the history and other
  recipes (`state-watch`) read an equipment's `state`; a recipe-only state (instance state, log)
  is invisible to them.

Today a recipe cannot do the second. `RecipeContext` hands it the raw `equipmentManager` and the
event bus: it could emit `equipment.data.changed` by hand, but nothing stores the value, no
surface reads it, history never writes it, and nothing stops it from writing any alias on any
equipment. Spec 111 closed that kind of door for plugins; recipes have no equivalent.

The core already has the mechanism to show a value no device reports: **virtual data bindings**,
injected into `dataBindings` at read time (a gate's `state`, a pool cover's `cover_state`). This
spec opens it to recipes, through a declared and checked channel. The washing-machine logic
itself is the first recipe built on it (`sowel-recipe-appliance-cycle`, its own spec).

Generic fixes found on the way are part of this spec (FR5.2, FR5.3, FR6): published data needs
them to show at all.

## Goals

1. A recipe declares, in its definition, the data it publishes on the equipment of one of its
   `equipment` slots, and publishes values through a dedicated helper.
2. The core shows that data as a virtual binding of the equipment: surfaces, history, recipes and
   pickers read it like any other binding.
3. The channel is closed: only declared aliases, only on the slot's equipments, only values of
   the declared type, one publisher per alias, never over a device-bound alias.
4. The appliance surfaces and the history show such a state correctly (FR6).

## Non-Goals

- The `appliance-cycle` recipe itself: its own repository and spec, built on this one.
- Publishing on a zone, or on an equipment outside the recipe's slots.
- Publishing orders (a recipe-defined order alias).
- Persisting published values in the core across a restart: the recipe republishes from its own
  persisted state (`ctx.state`).
- A history on/off toggle for published data (always historized in v1).
- Showing on the recipe settings page what an instance publishes.

## Functional Requirements

### FR1 — Declaration

1. `RecipeDefinition` (and `RecipeInfo`) gain an optional `publishes: RecipePublishDef[]`:

   ```ts
   interface RecipePublishDef {
     slot: string; // id of an `equipment` slot of this recipe
     alias: string; // the alias the data takes on the equipment
     type: "number" | "boolean" | "enum" | "text";
     category: DataCategory;
     enumValues?: string[]; // required when type is "enum"
     unit?: string;
   }
   ```

2. A declaration whose `slot` names no `equipment` slot, an `enum` without `enumValues`, or two
   entries with the same `slot` + `alias`, is rejected when the package is registered: the
   recipe is not loaded, with an error log naming the package and the entry.

### FR2 — Validation of an instance

When an instance is created, updated or enabled, for each declaration and each equipment the
slot resolves to (one, or several for a `list` slot), the instance is refused (`400` on create /
update, a logged error and no start on enable or at boot) when:

1. the equipment already has a **device-bound** data binding with that alias, or
2. another **enabled** instance already publishes that alias on that equipment.

The message names the equipment, the alias and, for 2, the other instance.

### FR3 — Publishing

1. `ctx.helpers.equipmentData.publish(equipmentId, alias, value)` sets the value. It returns
   `{ ok: true }` or `{ ok: false, reason }` and never throws.
2. It is denied (`reason`, plus a `warn` log `"Recipe denied …"` with instance, equipment and
   alias) when the alias is not declared for a slot resolving to that equipment, or the value
   does not match the declared type (`enum` outside `enumValues`, `number` not finite, …).
   `null` is always accepted: "unknown".
3. A published value differing from the current one emits `equipment.data.changed` with the
   alias, the value and the previous value. An identical value emits nothing.
4. `ctx.helpers.equipmentData` is absent on an older core, so a recipe can require it (its
   `sowelVersion` constraint) or degrade.

### FR4 — The virtual binding

1. While the instance runs, each declared alias appears in the equipment's `dataBindings` as a
   virtual binding: id `virtual:recipe:<instanceId>:<alias>`, the declared `type`, `category`,
   `enumValues`, `unit`, the current value (`null` until the first publish), `lastUpdated` /
   `lastChanged` from the publishes, `stale: false`, and `deviceName` set to the recipe's name so
   a surface can say where the value comes from.
2. A device binding with the same alias added later wins: the virtual binding is no longer
   injected and `publish` is denied for that alias (FR3.2), with one `warn` log per instance.
3. When the instance stops (disabled, deleted, updated, recipe package updated, core shutdown), its virtual bindings disappear and `equipment.updated` is emitted for each equipment
   concerned. No value is left behind.
4. When the instance starts, `equipment.updated` is emitted for each equipment concerned, so
   caches (history) pick the binding up before the first value.

### FR5 — History

1. Published data is historized like a device binding of the same type (enum: label in
   `value_string`, declared index in `value_number`, #434).
2. `GET /api/v1/history/bindings/:equipmentId` lists it with `virtual: true` and its
   `enumValues`. Gate and cover virtual bindings stay hidden, as today.
3. The history page shows no on/off toggle for a virtual series: there is no stored flag to set.

### FR6 — Showing an appliance state and a many-valued enum

1. **Appliance surfaces.** `AppliancePanel`, the appliance cases of `MobileWidgetCard`,
   `EquipmentWidget` and `CompactEquipmentCard` take the machine as on only when
   `power === true`. With a metering plug, `power` is a number of watts, so all four show **Off**
   mid-cycle today. They read on/off from `state` when it is known and not `off`, else a boolean
   `power`, else a numeric `power ≥ 1` W, through one helper `ui/src/lib/appliance.ts`, and label
   `ready` / `finished` ("Prêt" / "Terminé").
2. **History chart.** An `appliance_state` series is drawn on the 0/1 states axis, which clips
   more than two values. A series declaring more than two `enumValues` is charted like the
   multi-value cover and gate states (a plain numeric series of the index), whatever its category.
   `/history/bindings` carries `enumValues` for that. An undeclared multi-value state (#936)
   still clips.

These, with FR5.2 and FR5.3, were written and reviewed in PR #1271 and are re-applied from it.

## Acceptance Criteria

- [ ] A recipe declaring `publishes` on its `equipment` slot exposes a `virtual:recipe:…` binding
      on that equipment while it runs, `null` before its first publish.
- [ ] `publish` of a declared alias on the slot's equipment emits `equipment.data.changed` once
      per change; an undeclared alias, another equipment or a wrong value is denied and logged.
- [ ] Creating an instance over a device-bound alias, or over an alias another enabled instance
      publishes, is refused with `400`.
- [ ] Disabling or deleting the instance removes the virtual binding.
- [ ] A published enum is written to InfluxDB and listed by `/history/bindings` with `virtual`.
- [ ] A `state-watch` instance on a published `state` raises its alarm on the published value.
- [ ] The four appliance surfaces show a metered machine on mid-cycle, and label `ready` /
      `finished`.
- [ ] A published enum of four values is charted off the 0/1 axis.

## Edge Cases

- **Boot.** Instances start after the equipment manager; each declared alias appears with `null`
  and takes the recipe's first publish (a recipe republishes from `ctx.state` in `start`).
- **Instance updated with another equipment in the slot.** Stop then start: the old equipment
  loses the binding, the new one gets it.
- **Equipment deleted while the instance runs.** The binding goes with the equipment; later
  publishes are denied (no such equipment).
- **Recipe package updated.** Its instances restart (#349): stop then start, so the binding
  goes and comes back, `null` until the new version publishes.
- **Two declarations on a `list` slot.** One virtual binding per equipment of the list.
- **Shadow mode** (spec 124): instances do not start, nothing is published.

## Docs Delta

- `docs/technical/recipe-development.md` + `.fr.md`: new section "Publishing data on an
  equipment (spec 214)": `publishes`, `ctx.helpers.equipmentData.publish`, the rules (FR2, FR3),
  the lifecycle (FR4), republishing at start, the `sowelVersion` constraint.
- `docs/technical/data-model/equipments.md` (EN only): a table of the virtual bindings (gate,
  cover, `virtual:recipe:<instance>:<alias>`).
- `docs/technical/api-reference.md` + `.fr.md`: the `/history/bindings` row says a series a
  recipe publishes is listed with `virtual: true`, and enums carry `enumValues`.
- `docs/user/equipments.md` + `.fr.md`, Appliances: a recipe can give an appliance its run state
  from a metering plug; the end-of-cycle tip names `finished`.
- Screenshots: none.
