# Spec 177 — Public demonstrator: a living house anyone can visit

**Issue**: none yet — this spec is the map; each phase below opens its own issue
**Status**: proposed (macro spec — it records the decisions and the plan, and delegates the detail to one spec per phase)
**Related**: [#912](https://github.com/mchacher/sowel/issues/912) (standard users activate modes), spec 124 (shadow mode), spec 131 (role gate), spec 136 (personal plugin sources), spec 111 (plugin isolation), spec 140 (capacity arbiter), spec 161 (PV history backfill)

## Problem

Sowel has no public face. The docs show screenshots; the README shows a paragraph. Someone who wants to know _what the product does_ has to install it, bind hardware, and wait a week for the pages to fill. There is nothing to click on.

The maintainer's production is a good example of a Sowel home — PV, heat pump, shutters, motion lighting, modes, energy arbitration — but it is a family's home. Its data leaks who is where and when. It cannot be the demo, and an anonymised copy of it cannot either: an inert copy shows red banners, offline rows and empty charts. The `sowel-docs` skill states it plainly: _an inert instance cannot photograph a live one._

So the demonstrator needs **live data that belongs to nobody**, and a way for a visitor to **act and see Sowel react** — not a video, not a static tour.

## Goal

A public URL where anyone can open a Sowel instance that runs a fictional house: people live in it, the sun rises on it, its recipes fire, and a visitor can turn a light on, close a shutter, walk into a room and watch the motion sensor, the recipe and the journal do their job. Next to it, the same house rendered in 3D, driven by the same Sowel, so that what the visitor clicks in the picture is what Sowel actually does.

## Decisions already taken

These were settled in discussion and are not reopened by the phase specs:

| Topic                    | Decision                                                                                                            | Why                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source of the live data  | **Pure simulator**, no mirror of production                                                                         | A mirror leaks presence patterns and gives a read-only demo. A simulator is deterministic, safe, interactive.                                                                         |
| Can a visitor act?       | **Yes** — orders, modes, timed actions, simulation triggers                                                         | A demo you cannot touch is a screenshot.                                                                                                                                              |
| Several visitors at once | **One shared world**, with rules (below)                                                                            | Per-visitor worlds lose "one Sowel"; a queue is the fallback if sharing turns chaotic.                                                                                                |
| Who is the visitor       | A shared **guest account with the `standard` role**, auto-logged                                                    | Spec 131's fail-closed gate already limits a standard user to usage mutations.                                                                                                        |
| Hosting                  | A **dedicated VM** later; **local Docker** first                                                                    | The former demo host (`domopi`) no longer exists.                                                                                                                                     |
| Reset cadence            | **Nightly at 04:00**, as a safety net                                                                               | Rate limits + short overrides + a reconverging simulation make the reset rarely necessary. Adjust after observation.                                                                  |
| Energy history           | **No backfill.** The reset wipes SQLite and **keeps the InfluxDB volume**                                           | A plugin cannot write history, and replaying weeks through the pipeline is heavy. Real-time accrual is consistent with what the visitor sees; after a week the Energy pages are full. |
| Simulated time           | **Real time**, never accelerated                                                                                    | A visitor at 03:00 sees a sleeping house. History stays coherent.                                                                                                                     |
| The 3D house             | A **separate web app** (own repo), not a page of the product UI                                                     | Three.js has no business in the product bundle; the twin reads and writes through the public API like any client.                                                                     |
| 3D construction          | **Procedural** walls from a plan JSON + **CC0 low-poly furniture** (Kenney, Quaternius, Poly Pizza) + Sowel palette | No Blender skill required, everything data-driven, stylised rather than pseudo-realistic. The prototype (`prototype/maison-temoin.html`) validated the look.                          |
| Solar panels             | On the roof, so the house gets a roof — **later phase**                                                             | Requested; not needed to validate the rest.                                                                                                                                           |

## The three pieces and their contract

```
                 ┌──────────────────────────────────────────────────────┐
                 │  Sowel instance (SOWEL_DEMO_MODE=1)                   │
                 │                                                       │
   REST + WS     │  ┌────────────────┐      ┌──────────────────────┐    │
 ◄──────────────►│  │ Demo mode      │      │ Simulator plugin      │    │
                 │  │ - guest login  │      │ - occupants (agenda)  │    │
 3D twin         │  │ - allowlist    │      │ - sun, weather        │    │
 (own repo)      │  │ - rate limits  │      │ - thermal per room    │    │
                 │  │ - banner+count │      │ - PV, loads, grid     │    │
   orders,       │  │ - demo routes  │      │ - ephemeral presence  │    │
   sim triggers  │  └───────┬────────┘      │ - executes orders     │    │
 ──────────────► │          │               └──────────┬───────────┘    │
                 │          ▼                          ▼                │
                 │   Auth middleware ──► Device Manager ──► Event Bus   │
                 │                       Equipments ► Zones ► Recipes   │
                 │                       Modes ► Arbiter ► Influx       │
                 └──────────────────────────────────────────────────────┘
                              ▲                      ▲
                              │ same API, same WS    │
                        Sowel UI (product)      reset cron (nightly)
```

- **The simulator simulates the physical world, not the sensors.** It moves people, computes temperatures and power, and publishes them as ordinary device data. Motion lighting, presence heating, shutters at dusk, pool scheduling, capacity arbitration are **Sowel's own recipes and engines** running on top. Nothing in the simulator knows what a recipe is. That is the point of the demo: it is really Sowel doing the work.
- **Every write goes through Sowel.** The 3D twin sends equipment orders and simulation triggers through the public API; it never talks to the plugin. The product UI and the twin are two clients of one state.
- **Occupants are devices.** Each person is a simulator device with a `zone` enum reading. Their position is therefore visible to the API, the WebSocket, the history and the twin, with no side channel. A plugin has no other way to publish state, and it is the right way.
- **Two kinds of presence, from day one.** Scheduled occupants, and _ephemeral presence_ triggered from outside (a visitor's click). The second exists because of the multi-visitor rules below.

## Component A — the simulator plugin (`sowel-plugin-simulator`)

An integration plugin like any other: own GitHub repo, `createPlugin(deps)`, registry entry with `sha256` and `owner` (spec 089), installable through a personal source while it is being developed (spec 136). It runs under the spec 111 scoped deps: it can only write devices whose `integrationId` is its own — hence the fixture remap below.

**World model** (deterministic given the clock; real-time):

- **Occupants** — a small household (two adults, one or two children) with weekday and weekend agendas, small randomness, and a position that is a zone. Leaving and returning goes through the entrance (door contact opens). Each occupant is a device: `zone` (enum of zone names + `away`), `present` (boolean).
- **Environment** — sun elevation and azimuth (the core `sunlight-manager` already computes this from `home.latitude/longitude`; the plugin may read those keys), outdoor temperature with a seasonal baseline and a diurnal cycle, weather state (clear, cloudy, rain) that modulates PV and temperature, humidity spike in the bathroom after the morning shower.
- **Thermal** — first-order model per room: setpoint from the heating equipment's orders, loss towards outdoor, solar gain when shutters are open and the sun faces the window. Presence thermostats have something to regulate.
- **Energy** — PV = f(sun elevation, clouds) with a nominal peak; base load; appliances triggered by the agenda (cooking at 19:00, dishwasher after, laundry on Saturday); heat pump draw from the thermal model; controllable flexible loads (water heater, pool pump) that the capacity arbiter (spec 140) can actually allocate surplus to. Grid = load − PV, signed.
- **Ephemeral presence** — a motion pulse of N seconds in a zone, or a temporary ghost occupant that walks where told and expires after two minutes without input, capped at about ten at a time. Triggered only by simulation orders.

**Devices** — the catalogue comes from the anonymised showroom fixture (`docs/fixtures/showroom-fr.zip`), so the demo home _is_ the shape of the maintainer's home: same zones, same equipment types, same recipes and modes. `scripts/doc/build-fixtures.py` gains one step: rewrite every device's `integration_id` to `simulator` and add the simulator's own devices (occupants, weather station, grid meter, PV inverter). The plugin re-declares those devices through discovery on start so the bindings resolve.

**Orders** — the plugin executes every order the real integrations would (light `power`, shutter `position`, thermostat `setpoint`, heater `mode`…), updates the corresponding reading with a plausible delay, and never throws. In addition, sensors expose **simulation orders** that no real device has: `sim.motion` on a PIR, `sim.open`/`sim.close` on a door contact, `sim.temperature` on a probe, `sim.weather` on the weather station, `sim.enter`/`sim.leave` on an occupant, `sim.ghost` on a zone-level pseudo-device. They are ordinary `DeviceOrder`s so the whole existing plumbing (bindings, aliases, audit, WebSocket) applies.

**Non-goals** — writing InfluxDB history (impossible from a plugin, and not wanted, see decisions); simulating hardware failures (later, could be a nice demo of spec 116 staleness and alarms); anything time-accelerated.

## Component B — demo mode in the core (`SOWEL_DEMO_MODE=1`)

Same pattern as shadow mode (spec 124): one env flag read at boot, one banner, a list of subsystems that do not start. Nothing of it exists outside the flag.

- **Guest session** — `POST /api/v1/demo/session` returns a short-lived token pair for the guest user (role `standard`, created at boot if missing). The product UI auto-logs in when demo mode is on; the 3D twin calls the same route. No password shown, nothing to type.
- **Allowlist** — spec 131's standard allowlist, **plus** mode activation and deactivation (#912, so the demo carries no exception of its own), **plus** the demo routes, **minus** everything personal (password, tokens, MFA, push subscriptions), because the account is shared.
- **Rate limits** — per session: one mutation every 2 s, thirty per minute. Per equipment: a debounce so one target does not change more than once every few seconds regardless of who asks. Beyond that, Cloudflare per IP.
- **Short overrides** — a visitor's manual action on a recipe-managed equipment holds for two to three minutes, then the recipes take over again. (Whether this is a demo setting or a recipe parameter is for the phase spec.)
- **Banner** — non-dismissable, like shadow: "Public demo · reset nightly · N visitors in the house". `clients.size` on the WebSocket server is the count.
- **Attributed journal** — every action in the activity log names its origin: "A visitor turned on the living room light", "Léa entered the kitchen", "motion-light turned off the office". Transparency defuses the confusion of a shared world.
- **Disabled** — self-update, version check, plugin install/update/remove, backup restore, notification publishers, MQTT publishers, user management. The Docker socket is never mounted (spec 105).
- **Optional** — an in-app "Drive the house" sheet listing per zone the simulation orders found on its devices. The 3D twin is the primary click surface; this sheet is the fallback for a phone without WebGL and for the docs screenshots. Decide in the phase spec.

## Component C — the 3D twin (`sowel-demo-house`, own repo)

A static web app: Three.js, no backend of its own in v1.

- **Model** — a plan JSON (rooms as rectangles, walls with door/window openings, door graph for pathing, furniture placements) extruded procedurally; furniture from CC0 low-poly packs; palette from the Sowel design system (ocean blue, amber, warm off-whites). Later: a roof, and solar panels on it.
- **Mapping** — a JSON that ties plan objects to Sowel IDs: `light:salon` → equipment id, `window:salon-1` → shutter equipment, `room:salon` → zone id and the PIR device that carries `sim.motion`, occupant devices → figures. Versioned alongside the fixture: the plan and the fixture change together.
- **Reads** — REST for the initial state, WebSocket for everything after. Lamps glow on `power`, shutters slide on `position`, figures move on an occupant's `zone`, the sky follows the sun and the weather readings, the journal panel shows the activity log.
- **Writes** — clicking a lamp sends the equipment order; a window toggles its shutter; the floor of a room sends `sim.ghost` (v1: the visitor's own ghost walks there) — never moves the household.
- **Visitors** — v1: each visitor sees their own ghost and only the _effects_ of the others (LEDs, lamps, journal, count). Ghosts visible to everyone need a realtime channel Sowel does not give a plugin: v2, with a small WebSocket relay next to the app.
- **Prototype** — `prototype/maison-temoin.html` in this folder is the throwaway that validated the look (seven rooms, day cycle, weather, three occupants on an agenda, clickable lamps/shutters/floors, a fake motion-light for narration). It is self-contained and has no link to Sowel; keep it as the visual reference, do not grow it.

## Component D — operations

- **Compose** — `docker-compose.demo.yml`: Sowel with `SOWEL_DEMO_MODE=1`, InfluxDB, **no Docker socket**, plugin dir pre-seeded with the simulator, guest credentials in env.
- **Reset** — `scripts/demo-reset.sh`: stop, drop the SQLite volume only, start, run first-admin setup, restore the demo fixture, install the simulator from the registry (or a personal source in dev), verify `/api/v1/health`. Cron nightly at 04:00. Reuses the screenshot pipeline already scripted in the `sowel-docs` skill.
- **Fixture** — `docs/fixtures/demo.zip`, produced by `build-fixtures.py` from the showroom fixture with the simulator remap. The plan JSON of the twin is generated or checked against it.
- **Exposure** — a dedicated VM, Cloudflare tunnel (WAF, rate limit, bot protection), `demo.sowel.org`, link from `docs.sowel.org` and the README. Private host details go in `sowel-ops`, which must also drop its `domopi` demo section.
- **Local first** — everything above runs on a laptop with `docker compose -f docker-compose.demo.yml up`, before any VM exists.

## Multi-visitor rules

| Risk                                 | Rule                                                                  |
| ------------------------------------ | --------------------------------------------------------------------- |
| Lamps flicker under ten hands        | Per-equipment debounce, per-session quota                             |
| Occupants get dragged around         | Visitors never move the household; they get a ghost of their own      |
| Manual overrides pile up             | Overrides expire in minutes; recipes and agenda reconverge            |
| Nobody understands why it moved      | Attributed journal, visitor count in the banner                       |
| A script hammers the API             | Cloudflare per IP, session quota, nightly reset                       |
| The whole thing turns chaotic anyway | Fallback, not v1: one pilot at a time, two-minute slots, others watch |

## Out of scope (recorded so it is not lost)

- Solar panels on the roof, and the roof itself (asked for; phase 7).
- Ghosts visible to all visitors (needs a relay; v2 of the twin).
- Simulated hardware faults (staleness, offline devices, alarms) — a good later demo of spec 116 and the alarm surfaces.
- A floor-plan editor; the plan is a JSON edited by hand.
- Per-visitor private worlds; a pilot queue (fallback only).
- Any change to the product UI beyond the demo-only surfaces.

## Open questions

1. Which real recipes ship in the demo fixture, and do any of them need parameters tuned for demonstration (shorter timeouts)?
2. Does the guest session token expire per visitor (15 min access, refreshed) or is it a long-lived shared token? Leaning per visitor, standard TTLs.
3. Is the manual-override window a demo-mode setting or a recipe parameter? Affects component B vs the recipes.
4. Does the twin ship inside the demo compose (served by nginx) or as a separate static host? Leaning same compose, one tunnel.
5. Home location for the fixture: keep Paris (current showroom) or a sunnier fictional place for the PV story?

## Development plan

Each phase is one spec, one branch, one PR, testable on its own. Phases 1–3 are independent of the 3D work; the 3D depends on 1 and 2 only through the API.

```
 Phase 0 ── #912 standard users activate modes ─────────────────────────────┐
                                                                            │
 Phase 1 ── Simulator v1 (own repo + registry entry + fixture remap)        │
            world model, devices, order execution, simulation orders        │
            gate: installed on a local instance, Energy Live and the        │
            zones fill up, motion-light fires on a simulated occupant       │
                     │                                                      │
 Phase 2 ── Demo mode in core ◄─────────────────────────────────────────────┘
            flag, guest session route, allowlist, rate limits, banner,
            attributed journal, disabled subsystems
            gate: a fresh browser lands logged-in on a living house and
            cannot break anything
                     │
 Phase 3 ── Ops, local ── compose.demo, reset script, demo fixture, docs
            gate: `demo-reset.sh` from zero to living house in one command
                     │
 Phase 4 ── 3D twin, read-only ── plan JSON, mapping, REST + WS, sun/weather,
            occupants moving, lamps and shutters reflecting state
            gate: the twin mirrors the product UI with no lag a human notices
                     │
 Phase 5 ── 3D twin, interactive ── clicks → orders, own ghost, journal,
            visitor count, mobile
            gate: click a room in 3D, watch the PIR, the lamp and the
            journal react in the product UI on another screen
                     │
 Phase 6 ── Hosting ── VM, tunnel, demo.sowel.org, links from docs/README,
            sowel-ops updated, monitoring of the nightly reset
                     │
 Phase 7 ── Polish ── roof and solar panels, richer furniture, weather
            visuals, simulated faults, ghosts visible to all (relay)
```

Rough weight: phases 1 and 4–5 carry most of the work; 2, 3 and 6 are small; 0 is a one-liner plus tests and docs. Phase 1 alone already pays for itself: it gives the docs screenshot pipeline a live instance, which the `sowel-docs` skill has been missing.

## Acceptance for the macro spec

This spec is done when every phase above has its own numbered spec folder referencing it, and this document's decision table has not been contradicted by any of them without an explicit amendment here.
