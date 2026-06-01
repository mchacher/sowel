# Plan — Spec 121 — `sowel-plugin-energy-display`

Two work-streams. P1 lives in the new plugin repo; P2 is a one-line
registry change in this Sowel repo.

Order: P1 ships first (tagged GH release) → P2 (registry PR with
SHA256). Spec 120 must be merged before any of this lands.

---

## P1 — Plugin repo creation + initial release

Repo: `mchacher/sowel-plugin-energy-display`, branch `feat/initial-release`.

### P1.1 — Scaffolding

- [ ] `gh repo create mchacher/sowel-plugin-energy-display --public --description "..."`
- [ ] Copy the layout from `sowel-plugin-somfy-rts`: `package.json`,
      `tsconfig.json`, `.github/workflows/release.yml`, `manifest.json`,
      `README.md` template.
- [ ] Trim irrelevant Somfy-specific bits (RF, pairing).
- [ ] Pin `@sowel/plugin-api` to the version that ships spec 120.

### P1.2 — `manifest.json`

- [ ] Fill the manifest per architecture.md (id, kind, settings).

### P1.3 — `src/index.ts` — entry point

- [ ] `createPlugin(deps)` returns an `IntegrationPlugin`.
- [ ] `start()`: read settings, instantiate `MqttClient`, wire
      message handlers, emit `system.integration.connected` on connect.
- [ ] `stop()`: close MQTT, emit `system.integration.disconnected`.
- [ ] `executeOrder(device, key, value)`: delegate to
      `dispatch-order.ts`.
- [ ] `getStatus()`: return connected / disconnected.

### P1.4 — `src/mqtt-client.ts`

- [ ] Wrap `mqtt.js` with the project's existing patterns
      (reconnect with backoff, keep-alive 30 s, topic subscription
      helpers).
- [ ] `subscribe("<prefix>/+/availability")`,
      `subscribe("<prefix>/+/state")`.
- [ ] `publish("<prefix>/<id>/cmd/<key>", payload, { qos: 1 })`.

### P1.5 — `src/parse-state.ts` + tests

- [ ] Pure function `parseState(payload: string): ParsedState | null`.
- [ ] Map each canonical field to its `{ key, category, value }`.
- [ ] Permissive: missing / null / wrong-type → field dropped, no
      throw.
- [ ] Tests: 5 fixtures listed in spec.md acceptance (full / mandatory
      only / missing optional / unknown extras / malformed).

### P1.6 — `src/dispatch-order.ts` + tests

- [ ] Map `OrderCategory` → topic suffix + payload format.
- [ ] Clamp `set_display_brightness` to 0..100.
- [ ] Tests: 2 fixtures listed in spec.md acceptance.

### P1.7 — `src/availability.ts` + tests

- [ ] Parse `"online" | "offline"` (case-insensitive, trim).
- [ ] Tests: 3 scenarios (online, offline, garbage payload).

### P1.8 — Order declaration

- [ ] In `src/index.ts` state handler, after every
      `updateDeviceData`, check if the matching order exists on the
      device — if not, declare it. Done once per device per order
      category, then becomes a no-op.

### P1.9 — `.github/workflows/release.yml`

- [ ] On `v*` tag push: build `dist/index.js` (bundled), assemble
      `sowel-plugin-energy-display-<version>.tar.gz`, attach to the
      GH release.
- [ ] Mirror the somfy-rts workflow.

### P1.10 — README

- [ ] Quickstart: how to install via Sowel Admin → Plugins.
- [ ] MQTT contract reference (link to spec 121 once migrated into
      the repo).
- [ ] Troubleshooting: "no displays appear" / "orders not applied".

### P1.11 — First release

- [ ] Tag `v0.1.0` on `main`, GH workflow builds + attaches the
      tarball.

---

## P2 — Registry entry on Sowel

Repo: `mchacher/Sowel`, branch `feat/registry-energy-display`.

### P2.1 — Registry JSON

- [ ] `plugins/registry.json`: append an entry with
      `id: "energy-display"`, `owner: "mchacher"`, `repo`, `version`.
- [ ] Run `node scripts/backfill-registry-sha256.mjs` to populate
      the SHA256.
- [ ] Verify the entry matches the spec-089 schema (sha256 present,
      owner whitelisted as official since `mchacher` is in
      `OFFICIAL_OWNERS`).

### P2.2 — Smoke test

- [ ] Install the plugin via Sowel Admin → Plugins → Browse,
      pointing at the registry entry. Verify it appears, settings page
      opens, broker connect works.

### P2.3 — PR

- [ ] Commit message: `chore(registry): add energy-display plugin v0.1.0`.
- [ ] PR description: link to the plugin repo + the spec 121 doc +
      the smoke-test outcome.

---

## Phase 4 validation (P1 + P2)

```bash
# Plugin
npm run build          # in plugin repo
npm test               # all parse / dispatch / availability tests

# Sowel
node scripts/backfill-registry-sha256.mjs   # idempotent, verifies hash
npx tsc --noEmit       # no breakage from the registry change (none expected)
```

## Test plan

| Module           | Scenarios                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `parse-state`    | Full payload; mandatory-only; missing optional; unknown extras; malformed JSON                |
| `dispatch-order` | set_language → topic+payload; set_display_brightness → topic+payload (clamped)                |
| `availability`   | online; offline; garbage payload                                                              |
| Integration      | mock broker, end-to-end: state arrives → device created → status flips on LWT → order publish |

### What NOT to test

- The `display` equipment type — covered in spec 120 tests.
- The firmware — covered in spec 035 tests.
- The Sowel core data flow — exercised by existing plugin tests
  (somfy-rts, tasmota) so we know `updateDeviceData` /
  `executeOrder` plumbing is solid.

## Phase 5 — commit + PR (P1)

- Conventional commit: `feat(initial-release): MQTT supervision plugin for sowel displays (spec 121)`.
- PR description: link to spec 121, manual smoke test results.
- No `Co-Authored-By` line.

## Phase 6 — merge gate

Wait for explicit user OK before merging P1; same for P2.

## Follow-ups (out of this spec)

1. spec 122+ — admin UI improvements (live list of supervised
   displays under the plugin settings page).
2. spec 12X — OTA push from Sowel to displays (orchestrated via
   the plugin's MQTT channel).
3. spec 12X — "displays" recipe family (turn off all displays at
   22h, change language at boot, etc.).
4. spec 12X — TLS / mutual auth on the broker channel, once the
   broker is exposed beyond the LAN.
