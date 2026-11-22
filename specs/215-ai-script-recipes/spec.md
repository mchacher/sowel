# Spec 215: Recipes written by AI, as sandboxed scripts

**Status**: Idea, 2026-11-22. Mini spec to keep the direction; no code yet.

## Context

The launch film ends on a promise: "Something unusual in mind? Describe it. AI sees your house the way
you do, and writes the recipe. You install it." The feature does not exist. Public texts say "coming
soon" and never ask anyone to read code (maintainer, 2026-11-22).

Today a recipe is a TypeScript package in its own GitHub repository, built, released as a tarball,
listed in the registry with a `sha256` and an owner (spec 089), and loaded by `RecipeLoader`. It
receives a `RecipeContext` that hands it the whole `EquipmentManager`, `ZoneManager` and `EventBus`,
and it runs inside the Sowel process with all of Node.js. That is fine for code the maintainer
writes and reviews. It is not fine for code an AI writes and nobody reads.

## Options considered

**A. The AI writes a real recipe package.** Sowel compiles it (esbuild), runs its tests and installs
it locally, without GitHub. Rated 5/10:

- Full power, same format as today.
- Arbitrary code with every right in the process. Real isolation means a separate process, which
  breaks the synchronous `ctx` (equipment reads are direct calls).
- A build toolchain in the production image, and a new kind of package outside the registry and its
  `sha256` rule.

**B. The AI writes a script that Sowel runs in a sandbox.** Retained, rated 8/10. Nearly the power of
A for a fraction of the risk and the work. Detailed below.

**Rejected earlier**: a declarative JSON format filled by the AI. The maintainer wants real recipes,
close to what exists, using the full power of Claude or OpenAI.

## The idea

A **script recipe** is one JavaScript (or TypeScript) source text. Sowel runs it in **QuickJS compiled
to WebAssembly** (`quickjs-emscripten`), inside the Sowel process but with nothing of Node.js: no
file system, no network, no `require`, no `process`. The script sees only a small API that Sowel
hands it.

```js
recipe({
  name: "Welcome home path",
  slots: {
    gate: { type: "equipment", equipmentType: "gate" },
    lights: { type: "equipment", equipmentType: ["light_onoff", "light_dimmable"], list: true },
    offAfter: { type: "duration", default: "10m" },
  },
  start({ on, get, order, after, now, state, log }) {
    on("gate", "state", (value) => {
      if (value !== "open" || now().isDaylight) return;
      order("lights", "state", "ON");
      after(params.offAfter, () => order("lights", "state", "OFF"));
      state.set("summary", "Path lit");
    });
  },
});
```

To the rest of Sowel it is an ordinary recipe. A host adapter turns each script into a
`RecipeDefinition` registered with `RecipeManager`, so slots, the instance form, zone rows (spec 198),
tiles (spec 169), the Activity feed and modes work unchanged. The same script can be placed on another
zone like any recipe.

## Script API (first cut)

| Call                                 | Does                                                                               | Maps to                         |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------- |
| `on(slot, alias, fn)`                | Called when a data of a slot equipment changes                                     | `equipment.data.changed`        |
| `onZone(alias, fn)`                  | Called when an aggregated data of the recipe zone changes                          | `zone.data.changed`             |
| `get(slot, alias)`                   | Current value, synchronous                                                         | `EquipmentManager` read         |
| `order(slot, alias, value)`          | Sends an order to every equipment of the slot; fire and forget, outcome in the log | `ctx.dispatchOrder`             |
| `after(duration, fn)`, `every`, `at` | Timers; all cleared on stop                                                        | host timers                     |
| `now()`                              | Time, `isDaylight`, sunrise, sunset, tariff period                                 | `getSunlight`, `getTariff`      |
| `mode()`                             | Active mode of the zone                                                            | modes                           |
| `energy.claim / release`             | Ask the arbiter for surplus                                                        | `ctx.helpers.energy` (spec 140) |
| `state.set / get`, `log`             | Instance state (summary, alarm, countdown) and recipe log                          | `RecipeStateStore`, `ctx.log`   |

Rules enforced by the host, not by trust:

- `order` and `get` accept **only slot names**, never raw ids. A script cannot reach an equipment the
  user did not put in a slot.
- `order` checks the alias against the orders the equipment type declares.
- Async host calls (orders, history read of spec 211) resolve through QuickJS promises; the script
  never blocks.

## Runtime and safety

- One QuickJS runtime per instance, with a memory limit and an interrupt handler: a handler running
  more than N ms is cut, the instance is stopped with an alarm (`state.alarm`).
- A rate limit on `order` per minute, to catch loops between two recipes.
- Every order carries the instance attribution (spec 101), so the Activity feed says which script did
  what.
- Facts the user can trust come from Sowel, not from the AI: the equipments the script may touch (its
  slots) and the orders it may send (checked at runtime) are shown by Sowel itself.

## Storage and lifecycle

- Scripts live in SQLite (new table, one row per version): source, declared slots and i18n, the
  user's original request, author (user or AI provider), status. They go into backups with the rest;
  no GitHub, no tarball, no registry entry.
- Status: **draft** (written, tests pass) → **observing** (runs on live events, `order` only records
  "would have" lines in the recipe log) → **active**. The user moves it forward; the AI cannot.
- A core update that changes the script API keeps a versioned API (`recipe({ api: 1, ... })`).

## Testing

- **Syntax and API check**: the script is loaded in a throwaway runtime; errors go back to the AI.
- **Scenario tests written by the AI**, run in the sandbox with a fake clock and a recording `order`:

  ```js
  scenario("gate opens at night", ({ at, set, expectOrder }) => {
    at("21:00");
    set("gate", "state", "open");
    expectOrder("lights", "state", "ON");
  });
  ```

  They prove the code does what the AI meant, not what the user meant.

- **Observation on live events** is the real check: after a day or two the user reads "yesterday
  18:40, I would have turned on the garage light" and activates. Replaying past history was ruled out:
  InfluxDB keeps measures (temperature, power…) but not, by default, the triggers (motion, contacts,
  gates, buttons), see `src/shared/history-defaults.ts`.

## User experience

1. Settings: the user enters an API key (Anthropic or OpenAI). Sowel says plainly that the description
   of the home is sent to that provider. It is the user's AI, not a Sowel cloud.
2. A **Create a recipe** page: a chat on the left, the recipe card building up on the right (what it
   does, which equipments it may touch, tests, status).
3. The user describes the need; the AI asks one or two questions if needed.
4. Behind the scenes the AI loops: read the home, write the script, run the scenarios, fix.
5. The card shows "ready". The user clicks **Observe**, then **Activate** a few days later.
6. To change it, the user asks again in the same chat; a new version goes through the same steps.

## Architecture and phases

Sketch in [architecture.md](architecture.md), phases in [plan.md](plan.md).

## Open questions

1. Core or plugin? Since spec 053 nothing is built in, but the host needs the database, a page and a
   key in Settings.
2. Which data about the home is sent to the AI: names and types only, or current values too?
3. Is observing mandatory before the first activation, or offered?
4. How much of the arbiter API (spec 140) the first cut exposes.
5. CPU and memory cost of one QuickJS runtime per instance on a Raspberry Pi class host (to measure in
   phase 1).
