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

## What stays blocked on the Sowel side

Even once Netatmo opens access, the Advance's live view is WebRTC, and
the spec 133 media proxy speaks only HLS (and MJPEG). The snapshot would
work as it does for the Presence; live view needs the proxy to gain
WebRTC, which issue #553 already named as a larger, separate piece of
work.

## Next check

Re-run `homesdata` in mid-November 2026, once the firmware has had time to
roll out. It needs a token from the account that owns the `NPC` and `NOC2`
(Romain's).
