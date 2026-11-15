# Spec 209 — Plan

The steps and their content are in [spec.md](spec.md). This file tracks them.

## Steps

- [x] Audit of docs.sowel.org and the repository (2026-11-14, read-only)
- [x] Fix the broken install command on the landing (#1258)
- [x] Step 0 — Identity: better logo, delivered by spec 210 (#1260)
- [x] Message architecture and reference pitch, [pitch.md](pitch.md) (2026-11-15)
- [ ] Motion design piece built from the pitch, before the GitHub storefront (maintainer's call, 2026-11-15)
- [ ] Step 1 — Hygiene: screenshots (#1127), French navigation labels, GitHub description, topics, homepage,
      Discussions, README storefront, `sowel.org` DNS and `install.sh` redirect, clean-machine install test
      (timed, from install to a first recipe running)
- [ ] Step 2 — Showcase: spec and repository `sowel-site`; `docs.sowel.org` back to the manual
- [ ] Step 3 — Proof: 60 to 90 second video, one numbered real case, two articles (FR and EN)
- [ ] Step 4 — Launch (week 7, staggered): French channels, English channels, awesome-selfhosted PR
- [ ] Step 5 — Upkeep: reply within 24 hours, one piece a month, `demo.sowel.org` as second wave

## Gates

- Step 1's clean-machine install test passes before step 4 starts.
- The promise wording is read by about five people before step 2 is built (the axis is fixed).

## Test Plan

None: this spec changes no code. The checks that apply to it are the docs and specs gates
(`check-specs-complete`, `check-specs-index folders`, `check-docs-parity`, `check-docs-impact`).
