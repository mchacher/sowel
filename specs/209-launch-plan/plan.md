# Spec 209 — Plan

The steps and their content are in [spec.md](spec.md). This file tracks them.

## Steps

- [x] Audit of docs.sowel.org and the repository (2026-11-14, read-only)
- [x] Fix the broken install command on the landing (#1258)
- [x] Step 0 — Identity: better logo, delivered by spec 210 (#1260)
- [ ] Step 1 — Hygiene
  - [x] GitHub description, topics, homepage, Discussions (2026-11-21)
  - [x] README storefront (#1276, #1282)
  - [x] Screenshots with live data (#1127, #1278); `pv-monitoring` still to retake
  - [x] French navigation labels (#1279)
  - [x] Clean-machine install test (2026-11-21, Docker Desktop on macOS, not a clean Linux host). It found
        that the InfluxDB buckets and tasks were never created on a first start (#1284), fixed in v1.88.1
  - [ ] Launch film upload
- [ ] Step 2 — Showcase: spec and repository `sowel-site`; `docs.sowel.org` back to the manual
- [ ] Step 3 — Proof: 60 to 90 second video, one numbered real case, two articles (FR and EN)
- [ ] Step 4 — Launch (week 7, staggered): French channels, English channels, awesome-selfhosted PR
- [ ] Step 5 — Upkeep: reply within 24 hours, one piece a month, `demo.sowel.org` as second wave

## Gates

- Step 1's clean-machine install test passes before step 4 starts.
- The promise is chosen after two variants are read by about five people, before step 2 is built.

## Test Plan

None: this spec changes no code. The checks that apply to it are the docs and specs gates
(`check-specs-complete`, `check-specs-index folders`, `check-docs-parity`, `check-docs-impact`).
