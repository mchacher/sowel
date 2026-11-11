# Spec 206 — Solar settings tab

## Context

Settings › Énergie holds three cards: the electricity contract, prices and off-peak hours (specs 123, 202,
203), the surplus arbiter (spec 140) and the solar installation (spec 177). Specs 202 and 203 made the first card
long, and the page now mixes what the grid charges with what the panels produce. The maintainer asked
(2026-11-11) for a dedicated tab.

## Goals

1. « Énergie » holds the grid side: contract, prices, off-peak hours.
2. A new tab « Solaire » holds the solar side: the installation, then the surplus arbiter.
3. Every link into Settings lands on the tab that holds what it points at.

## Non-Goals

- No change inside any card.
- No new setting, route or permission: the tab is admin-only like « Énergie ».

## Functional Requirements

### FR1 — Tabs

Order: Général, Compte, Énergie, Solaire, Administration. « Solaire » (EN « Solar ») is admin-only and shows the
solar installation card, then the arbiter card. « Énergie » shows the tariff card alone.

`?tab=solar` opens it, like the other entry points (spec 163); a non-admin falls back to « Compte ».

### FR2 — Links

The links to the solar installation (Production page setup hint, PV forecast panel « déclaré ») point at
`?tab=solar`. The links to the prices (Bilan) keep `?tab=energy`.

### FR3 — Phone

Five tabs do not fit 390 px. The tab bar scrolls sideways, labels on one line, without a visible scrollbar
track, and the active tab is scrolled into view when the page opens on it.

## Acceptance Criteria

- [ ] « Énergie » shows the tariff card only; « Solaire » the installation then the arbiter.
- [ ] `?tab=solar` opens « Solaire » for an admin, « Compte » for a standard user.
- [ ] The Production and PV forecast links open « Solaire ».
- [ ] At 390 px the bar scrolls and the page has no horizontal scroll; `?tab=admin` shows its tab in view.

## Edge Cases

- An old bookmark `?tab=energy` still opens « Énergie »; the arbiter is one tab away.
- No production meter: « Solaire » still shows both cards (they explain what is missing), as « Énergie » did.

## Docs Delta

| Page (EN and FR)                          | Change                                                          |
| ----------------------------------------- | --------------------------------------------------------------- |
| `docs/user/energy.md` + `.fr.md`          | « Réglages › Solaire » for the installation and the arbiter     |
| `docs/deep-dives/pv-health.md` + `.fr.md` | the path to the installation card                               |
| `docs/deep-dives/surplus-arbiter.md` + FR | the path to the arbiter card                                    |
| any other page naming those paths         | same (grep « Réglages › Énergie » / « Settings › Energy »)      |

Release notes of past versions are left as they are. Screenshots: none of the existing ones shows the tab bar
with the tabs named, to check when implementing.
