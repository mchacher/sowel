# Netatmo camera API — status of the newer models

A dated log of what the Netatmo public API exposes for the newer camera
models, kept here because it gates what the camera equipment type
(spec 133) can show. The plugin itself lives in
[`alpitux/sowel-plugin-netatmo-camera`](https://github.com/alpitux/sowel-plugin-netatmo-camera),
whose spec 001 holds the full test history. Add an entry each time the
question is looked at again.

## The gap

| Model                           | Code   | In `homesdata` / `homestatus` | Live view                             |
| ------------------------------- | ------ | ----------------------------- | ------------------------------------- |
| Presence (Smart Outdoor Camera) | `NOC`  | Yes                           | HLS, works through the spec 133 proxy |
| Indoor Camera Advance           | `NPC`  | **No**                        | WebRTC (not HLS)                      |
| Outdoor camera, new generation  | `NOC2` | **No**                        | Unknown                               |

Last direct test on 2026-08-21 (plugin spec 001): with all 24 scopes the
dev app can request, a fresh token and a re-authorisation, `homesdata`
still returns 17 modules and a single camera, the `NOC`. Scopes are ruled
out, including the rumoured `cameraextnoc2` and `cameraextnpc`, which do
not exist in the scope list. The cause is on Netatmo's side.

## 2026-10-25 — review

No fix in the field yet, but Netatmo has one in progress.

- **Netatmo.** A contributor working with Netatmo's teams reports in
  [home-assistant/core#140629](https://github.com/home-assistant/core/issues/140629)
  (open since 2025-03):
  - 2025-12: for privacy reasons, access to the Advance requires
    permissions that Netatmo grants by hand, and the camera firmware needs
    a change. It is the first time Netatmo exposes a WebRTC stream to a
    third party.
  - 2026-08-19: the cloud side is merged; the firmware change remains.
  - 2026-09-09: the firmware change is planned for the **end of
    October 2026** release, with the caveat that the date may slip.
  - No rollout announced as of 2026-10-25.
- **pyatmo**, the reference Python library: `NPC` is parsed since 9.1.0,
  its WebRTC live stream is supported since 9.4.0. The API shape is
  therefore known for the day access opens.
- **`NOC2`**: mentioned nowhere, neither in pyatmo nor in the Home
  Assistant thread. It looks further behind than the Advance.

## 2026-11-08 — review

The end-of-October firmware has not shipped.

- **Netatmo.** No word from the contributor since 2026-09-09. On
  2026-11-08 users in
  [home-assistant/core#140629](https://github.com/home-assistant/core/issues/140629)
  ask for news and note that the Advance's last firmware dates from
  October 2025; a release note quoted as new turned out to be that 2025
  one.
- **pyatmo**: no release since 9.9.1 (2026-08-26). Nothing about `NPC`,
  `NOC2` or WebRTC since the last review.
- **Home Assistant**: plenty of Netatmo PRs since 2026-10-15 (siren
  control, camera attributes, error handling), all for the existing
  models. None adds `NPC` or `NOC2`.
- **`NOC2`**: still mentioned nowhere.

## 2026-11-22 — review

The firmware change is moving, but no public rollout yet.

- **Netatmo.** On 2026-11-11 the contributor in
  [home-assistant/core#140629](https://github.com/home-assistant/core/issues/140629)
  writes that the release is awaiting QV validation, expected to start the
  week of 2026-11-16, and that his own camera already runs the new
  firmware. So the end-of-October date slipped by about three weeks.
- **A first user report.** On 2026-11-13 a user says that after logging in
  again on a Netatmo plugin (not named) the Advance appeared. Single
  unverified report, no scope or plugin given, nothing since.
- **pyatmo**: still 9.9.1 (2026-08-26); only a webhook fix and dependency
  bumps since 2026-11-08. **Home Assistant**: Netatmo PRs since 2026-11-08
  are enum clean-ups, climate and preset fixes; none adds `NPC` or `NOC2`.
- **`NOC2`**: still mentioned nowhere.

## 2026-11-22 — direct test and Home Assistant state

**Direct test: negative.** Token generated in the developer portal with
every scope (the `camerapro` ones included), on the maintainer's account,
which owns one `NPC` and two `NOC2`. `homesdata` and `homestatus` return
the seven other modules (weather station `NAMain`, `NAModule1`,
`NAModule2`, `NAModule3`, Legrand gateway `NLG`, two `NLPC`) and no camera
of any kind. `gethomedata` returns an empty camera list. A first token
generated without scopes showed no module at all and `getstationsdata`
answered 403, so the missing cameras are not a scope problem. The cameras'
firmware versions were not checked in the Netatmo app.

**Live view is a second gate.** WebRTC (`api/webrtc/offer`,
`api/webrtc/terminate`, scopes `access_camerapro`, `read_camerapro`,
`write_camerapro`) needs the application to be approved by Netatmo, also
for one's own cameras
([pyatmo#548](https://github.com/jabesq-org/pyatmo/pull/548)). A Netatmo
community moderator wrote on 2026-04-09 that third-party access to the NPC
live stream is not allowed for now, "mainly for costs reasons linked to
the way WebRTC works", and that the documentation would be removed
([forum thread](https://helpcenter.netatmo.com/hc/en-us/community/posts/34646400553618-Indoor-Camera-Advance-live-stream-API-access)).
The contributor in #140629 says instead that Netatmo is arranging access
for Home Assistant through the Open Home Foundation. The two statements
disagree, and the later one is the contributor's. Sowel would need its own
approval for live view; whether state, events and snapshots need one is
not confirmed anywhere.

**Home Assistant.** Nothing merged and no open PR for the Advance. The
`netatmo` integration on `dev` has no WebRTC code and pins pyatmo 9.9.0.
The contributor's branch `feature/netatmo-advance-camera-support` (fork
`taltenbach/core`, three commits, last on 2026-03-19, marked WIP) adds
WebRTC to `camera.py` with two FIXMEs: it breaks the HLS cameras (Home
Assistant then assumes every Netatmo camera is WebRTC), and it waits one
second in place for the ICE candidates because the Advance does not
trickle them. The branch is about 22,500 commits behind `dev` and has not
been proposed. `NOC2` appears in none of these sources.

## What stays blocked on the Sowel side

Even once Netatmo opens access, the Advance's live view is WebRTC, and
the spec 133 media proxy speaks only HLS (and MJPEG). The snapshot would
work as it does for the Presence; live view needs the proxy to gain
WebRTC, which issue #553 already named as a larger, separate piece of
work.

## Next check

Check the firmware version of the `NPC` in the Netatmo app, and re-run
`homesdata` (token with every scope, from the maintainer's account, which
owns the `NPC` and the `NOC2`) when it changes or once the rollout is
announced in #140629. Also watch for a Home Assistant PR carrying the
WebRTC work.
