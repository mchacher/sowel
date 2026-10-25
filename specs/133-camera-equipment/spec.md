# Spec 133 — Camera equipment type

## Context

Romain wants his surveillance cameras visible and controllable from the
Sowel UI. He owns cameras from three different vendors:

- **Netatmo** (Security API — Presence outdoor, Welcome indoor, Smart Video
  Doorbell)
- **Eufy** (S220 SoloCam, SoloCam E30)
- **Foscam** (FI9805E)

Sowel has no camera model today. Rather than build one plugin that hardcodes
Netatmo's data shape into the UI, this spec follows the precedent set by
spec 120 (`display` equipment type): freeze a **protocol-agnostic `camera`
equipment type in core Sowel first**, then ship one plugin per vendor,
starting with Netatmo, each of which only has to bind its device data into
the categories this spec defines.

This spec covers **Sowel core only** — new equipment type, data/order
categories, the media-proxy HTTP route, and all UI touchpoints. The Netatmo
plugin (`sowel-plugin-netatmo-camera`) ships under its own spec, in its own
repo, once this contract is frozen. Eufy and Foscam plugins are future work,
out of scope here, but this contract must not preclude them (see "Vendor
neutrality" below).

## Goals

1. Introduce a `camera` equipment type — sibling to `weather`,
   `energy_meter`, `display`, etc. — observable in the dashboard, zone
   view, and equipment detail page.
2. Introduce new `DataCategory` values a camera can report:
   - `camera_snapshot_url` — URL Sowel's backend can fetch a current still
     frame from (string, opaque to the UI; may be a signed/short-lived URL)
   - `camera_stream_url` — URL for a live view (HLS `.m3u8` or MJPEG;
     `unit` field reused to carry the stream kind, e.g. `"hls"` / `"mjpeg"`,
     so the player component knows how to render it)
   - `camera_monitoring` — boolean, is the camera currently armed/recording
   - `camera_light_mode` — enum (`"auto"` / `"on"` / `"off"`), only present
     on cameras with a floodlight/spot (e.g. Presence) — polymorphic like
     spec 120, absent fields are hidden, not defaulted
   - `camera_detection` — momentary event data (kind + timestamp +
     optional snapshot URL), same modeling pattern as the existing
     `action` category used by buttons (see "Detections as data, not a
     new event type" below), NOT a bespoke EventBus event
3. Introduce new `OrderCategory` values: `set_camera_monitoring` (boolean),
   `set_camera_light_mode` (enum), `trigger_camera_siren` (action, no
   payload) — all optional per-device, a plugin only exposes the orders its
   hardware actually supports.
4. New **media-proxy API route**: `GET
/api/v1/equipments/:id/camera/snapshot` and `GET
/api/v1/equipments/:id/camera/stream`. The backend resolves the bound
   device's current `camera_snapshot_url` / `camera_stream_url`, fetches
   from the plugin's network context (which may be LAN-local and
   unreachable from the browser directly), and streams the bytes back to
   the authenticated UI client. This is new infrastructure — Sowel has no
   binary/media route today (confirmed: grepped `src/api/routes/`, nothing
   comparable).
5. New widget family: dashboard card (desktop + mobile), zone compact card
   (snapshot thumbnail, refreshed on an interval), and an equipment detail
   panel with the live view player + monitoring/siren controls.
6. Detections (motion / person / vehicle / animal) reuse the button
   pattern: bound as `camera_detection` data, surfaced through the
   already-existing `equipment.data.changed` event, so they need no new
   recipe-trigger machinery — a recipe already knows how to trigger on an
   equipment data change (that's how button actions work today).
7. Online/offline status uses the existing `EquipmentStatus` derivation
   (spec 116), same as spec 120.
8. **Every camera feature is admin-controlled, per equipment, via
   binding** — see "Per-equipment feature enablement" below. This is the
   direct answer to Romain's requirement: whether live stream / snapshot /
   monitoring control / spot / siren / detections are active on a given
   camera is the admin's explicit choice, independent of what the device
   happens to support.

## Per-equipment feature enablement (binding-gated, not a new settings blob)

Romain wants every camera capability — snapshot, live stream, monitoring
toggle, spot/light control, siren, detection events — individually
switchable **per camera**, both because not every device supports every
feature and because an admin may deliberately not want a feature active
(e.g. no live stream proxied for a kitchen camera even though the device
supports it).

Sowel already has exactly this mechanism: **binding**. A `DataBinding` /
order binding is the admin explicitly opting a specific device data
point / order into a specific equipment. Nothing new needs to be invented:

- If `camera_stream_url` is not bound on a camera equipment, there is no
  live view for that equipment — full stop, regardless of whether the
  underlying device/plugin exposes a stream URL.
- Same for `camera_snapshot_url`, `camera_monitoring` (order + data),
  `camera_light_mode`, `trigger_camera_siren`, `camera_detection`.
- This is enforced **in the backend**, not just hidden in the UI: the
  media-proxy route and the order-dispatch path both check "is this
  category bound on this equipment?" before doing anything — see
  Acceptance Criteria. A feature the plugin/device supports but the admin
  didn't bind must be unreachable even via a direct API call, not just
  absent from the UI (this matters for privacy, not just UX polish).
- The existing equipment binding editor (`DeviceSelector.tsx` /
  `bindingUtils.ts`, touchpoint #6/#7 of the plugin-integration checklist)
  is where the admin adds/removes these bindings per camera — no new UI
  surface needed for this, beyond making sure all 6 categories are
  selectable there.

**Proposed default auto-binding** (auto-binding already exists today when
an equipment is created from a device — see `RELEVANT_DATA` /
`RELEVANT_ORDERS` in `bindingUtils.ts`): auto-bind `camera_snapshot_url`,
`camera_stream_url`, and `camera_monitoring` (data + order) by default,
since those are the core "just tell me the camera is there, let me see
it" experience. Do **NOT** auto-bind `camera_light_mode`,
`trigger_camera_siren`, or `camera_detection` — those are opt-in only,
added explicitly by the admin afterwards, given their
privacy/notification-noise implications. **Flagging this default split
for confirmation before implementation** — easy to flip if Romain wants a
different default.

## Vendor neutrality (why this matters for Eufy/Foscam later)

- `camera_snapshot_url` / `camera_stream_url` are **plugin-resolved**, not
  Sowel-resolved: each plugin decides what URL to hand over (Netatmo:
  Netatmo's local/vpn relay; Foscam/Eufy: likely a direct RTSP-to-HLS or
  MJPEG endpoint the plugin serves itself from the device's local IP). The
  media-proxy route in Sowel core is transport-aware (`unit: "hls" |
"mjpeg"`) but vendor-agnostic.
- Orders are all optional — Foscam FI9805E (an older ONVIF-ish model) may
  not support `set_camera_light_mode` at all; the UI must hide controls for
  orders the bound device doesn't expose, exactly like spec 120's
  polymorphism principle.

## Non-Goals

- The Netatmo plugin itself (`sowel-plugin-netatmo-camera`) — separate spec,
  separate repo, once this contract is frozen. Same split as spec 120 /
  `sowel-plugin-energy-display`.
- Eufy and Foscam plugins — future specs.
- Recording / clip storage inside Sowel. Sowel only ever proxies a live
  snapshot/stream; historical clips stay wherever the vendor stores them
  (e.g. Netatmo's own cloud on paying plans). The `camera_detection` value
  may carry a `snapshotUrl` pointing at the vendor's storage, not Sowel's.
- Two-way audio, doorbell call handling, facial recognition / person
  identity management (Welcome-specific) — camera-specific UX beyond
  "see the feed, arm/disarm, trigger siren".
- A "cameras" recipe action family beyond what `set_camera_monitoring` /
  `trigger_camera_siren` orders already allow through the generic order
  action — no bespoke recipe UI in this spec.
- Zone-level aggregation of camera events (see Goal 6 above).

## Media-proxy route — design notes

- Auth: same JWT/API-token middleware as every other `/api/v1/*` route —
  no separate auth scheme for media.
- The route calls into the owning plugin (via the existing order/refresh
  plumbing, not a new plugin API surface) to get bytes, rather than the UI
  talking to `camera_snapshot_url` directly — this preserves plugin soft
  isolation (spec 111): the browser never learns a camera's LAN IP or the
  plugin's upstream credentials.
- Live stream (`.../camera/stream`) is a byte-passthrough proxy (HLS
  segments or MJPEG multipart), not a transcode — if the upstream is HLS,
  Sowel proxies the `.m3u8` + `.ts` segments as-is to an `<video>`/hls.js
  player in the UI; if MJPEG, proxies the `multipart/x-mixed-replace`
  stream to an `<img>` tag. No server-side transcoding in this spec —
  out of scope, revisit if a vendor needs it.
- Snapshot polling interval for the dashboard/zone thumbnail: configurable
  per equipment (default TBD during implementation, likely 30–60s to stay
  polite to the upstream — Netatmo's own app polls similarly).

## Acceptance Criteria

### API

- [ ] `POST /api/v1/equipments` with `{ type: "camera", name, zoneId }`
      succeeds, returns an `Equipment` with `type === "camera"`.
- [ ] Bindings to device data of category `camera_snapshot_url`,
      `camera_stream_url`, `camera_monitoring`, `camera_light_mode`,
      `camera_detection` succeed and surface via
      `/api/v1/equipments/:id`.
- [ ] `POST /api/v1/equipments/:id/orders` with category
      `set_camera_monitoring` / `set_camera_light_mode` /
      `trigger_camera_siren` dispatches through the existing plugin order
      path **only if that order category is bound on this equipment** —
      unbound-but-device-capable returns the same "no such order" error as
      any other unbound order today, no special-casing needed.
- [ ] `GET /api/v1/equipments/:id/camera/snapshot` returns the current
      frame (binary, correct `Content-Type`) **only if `camera_snapshot_url`
      is bound** on that equipment; 404-style error otherwise, even if the
      underlying device exposes a snapshot URL. Also errors cleanly if
      bound but the camera is offline.
- [ ] `GET /api/v1/equipments/:id/camera/stream` proxies a live stream
      **only if `camera_stream_url` is bound**, same enforcement as
      snapshot above.

### Backend logic

- [ ] `equipment-manager` accepts `camera` in `VALID_EQUIPMENT_TYPES`.
- [ ] `binding-candidates` proposes all 5 new data categories and 3 new
      order categories when binding to a `camera`.
- [ ] Auto-binding on equipment creation from a device follows the default
      split above: `camera_snapshot_url` + `camera_stream_url` +
      `camera_monitoring` (data + order) auto-bound, the rest opt-in only.
- [ ] A `camera_detection` binding update fires the existing
      `equipment.data.changed` event (alias `camera_detection`) exactly
      like any other bound data point — no new EventBus event type — and
      is usable as a recipe trigger the same way button `action` already
      is.
- [ ] Missing/absent camera orders (e.g. no siren on a Welcome, or simply
      not bound by the admin) don't appear as available orders for that
      equipment — polymorphism holds for both "device doesn't support it"
      and "admin didn't enable it".

### UI (all 16 touchpoints from the plugin-integration skill checklist)

- [ ] Equipment creation form offers `camera` as a type.
- [ ] Zone compact card shows a live-ish snapshot thumbnail (refreshed on
      interval) + online/offline state.
- [ ] Dashboard widget (desktop + mobile) shows the same thumbnail + a
      monitoring on/off quick toggle if the order is available.
- [ ] Equipment detail page has a dedicated `CameraPanel.tsx`: live view
      player (HLS via hls.js or native `<video>`, or MJPEG `<img>`,
      selected from `unit`), monitoring toggle, light-mode control and
      siren button (both hidden if unsupported), recent `camera_detection`
      history — every element hidden if its category isn't bound on this
      equipment, whether that's because the device doesn't support it or
      because the admin didn't enable it.
- [ ] i18n keys added in `en.json` / `fr.json`.

## Edge Cases

- Camera bound but currently offline (device status stale/LWT-equivalent
  down for polling plugins) — thumbnail/player show a clear offline state,
  no broken image icon.
- `camera_stream_url` resolves to a LAN-local address unreachable from
  wherever Sowel's backend runs relative to the camera (e.g. Sowel not on
  the same L2 segment) — plugin should fall back to a cloud relay URL if
  the vendor offers one (Netatmo does via `vpn_url`); Sowel core doesn't
  need to know this happened, it just gets a URL from the plugin.
- Upstream snapshot/stream fetch fails or times out — media-proxy route
  returns a clean error status, UI shows a retry affordance, not a spinner
  forever.
- Equipment deleted/unbound while a client has an open stream connection —
  proxy connection is torn down cleanly.
- A vendor camera with no `camera_light_mode` / no siren (Welcome, Doorbell,
  most third-party ONVIF cameras) — those controls simply don't render.

## Open questions for implementation (not blocking spec approval)

- Exact default snapshot poll interval — pick during implementation,
  informed by what's polite for the Netatmo API rate limits once the
  Netatmo plugin is built against this contract.
- Whether `camera_stream_url`'s `unit` field is the cleanest way to signal
  stream kind (`"hls"` vs `"mjpeg"`) vs. a dedicated field — flagged for a
  second look once a plugin actually needs it, in the follow-up plugin spec.

## See also

- [netatmo-api-status.md](netatmo-api-status.md): dated log of what the
  Netatmo API exposes for the newer models (Indoor Camera Advance `NPC`,
  outdoor `NOC2`), not yet visible to third-party apps.
