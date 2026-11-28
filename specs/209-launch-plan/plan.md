# Spec 209 — Plan

The steps and their content are in [spec.md](spec.md). This file tracks them.

## Steps

- [x] Audit of docs.sowel.org and the repository (2026-11-14, read-only)
- [x] Fix the broken install command on the landing (#1258)
- [x] Step 0 — Identity: better logo, delivered by spec 210 (#1260)
- [x] Message architecture and reference pitch, [pitch.md](pitch.md) (2026-11-15)
- [x] Motion design piece built from the pitch, before the GitHub storefront: the launch film (rendered 2026-11-16; upload under Step 1)
- [ ] Step 1 — Hygiene
  - [x] GitHub description, topics, homepage, Discussions (2026-11-21)
  - [x] README storefront (#1276, #1282)
  - [x] Screenshots with live data (#1127, #1278); `pv-monitoring` kept as is (needs weather irradiance and a simulated fault the fixture lacks)
  - [x] French navigation labels (#1279)
  - [x] Clean-machine install test (2026-11-21, Docker Desktop on macOS, not a clean Linux host). It found
        that the InfluxDB buckets and tasks were never created on a first start (#1284), fixed in v1.88.1
  - [ ] Launch film upload
- [x] Step 2 — Showcase
  - [x] `sowel-site` is live at https://sowel.org (one bilingual page, no comparison section)
  - [x] `docs.sowel.org` is a plain manual again: scroll-flip landing retired, Material theme on the site's tokens
- [ ] Step 3 — Proof: 60 to 90 second video, one numbered real case, two articles (FR and EN)
  - [x] Launch film (long 2:38, short 1:14), on sowel.org
  - [x] Articles on sowel.org, FR and EN: solar surplus, comfort, knowledge of the home
  - [ ] One numbered real case
  - [ ] Short tutorials (idea of 2026-11-28): one concrete result each, 5 or 6 captures, about 600 words,
        titled by the result, not the mechanism. First list: install on a Raspberry Pi in 15 minutes, a first
        Zigbee plug or sensor, light on entering a room, alert when the garage door stays open, water heater on
        solar surplus, Away mode. On sowel.org in a Guides section, each linked to its manual page. None on AI
        recipes until they ship. Background articles stay, one a month at most.
- [ ] Step 4 — Launch (week 7, staggered): French channels, English channels, awesome-selfhosted PR
- [ ] Step 5 — Upkeep: reply within 24 hours, one piece a month (a tutorial or an article), `demo.sowel.org` as second wave

## Gates

- Step 1's clean-machine install test passes before step 4 starts.
- The promise wording is read by about five people before step 2 is built (the axis is fixed).

## Test Plan

None: this spec changes no code. The checks that apply to it are the docs and specs gates
(`check-specs-complete`, `check-specs-index folders`, `check-docs-parity`, `check-docs-impact`).
