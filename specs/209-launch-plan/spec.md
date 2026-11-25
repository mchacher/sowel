# Spec 209 — Launch plan: identity, showcase, proof, launch

## Context

On 2026-11-14 the maintainer judged that Sowel has reached real maturity (v1.87.0, 38 registry plugins, a live
energy arbiter) but has no public face and no communication strategy. A read-only audit the same day found:

- **Reach is near zero**: 8 stars, 4 forks, 208 page views (31 unique visitors) on the repository over the last
  14 days; no topics, no homepage URL on the GitHub repository.
- **docs.sowel.org does four jobs at once** (showcase, manual, developer portal, specs index) and does none of
  them as a showcase: no demo, no video, no named alternative, no community channel beyond GitHub, three
  screenshots from before the spec 196 refresh (#1127), a French navigation that mixes languages.
- **The landing's install command never worked**: it showed `https://sowel.org/install.sh`, a host with no DNS
  record. Fixed in #1258 (the command now uses the `raw.githubusercontent.com` URL; the illustration says
  `sowel:latest`). A short `sowel.org/install.sh` is still open (Cloudflare, outside the repository).
- **The hero sells a mechanism** (« Apply recipes to it »), not a result; Home Assistant has blueprints.
- **The logo** is a single-weight outline house with a smile, drawn once and never revisited; it is the first
  thing every later step reuses (favicon, social card, video, site).
- **Assets exist but are hidden**: the public demonstrator (sowel-showroom, phases 0 to 4 done or advanced), the
  live energy arbiter, and « The Sowel Method » (`docs/developers`, `docs/numericists`, both `noindex`).

## Decisions (maintainer, 2026-11-14)

| Topic       | Decision                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal        | **End users**: households that install Sowel. Success is installs, not stars.                                                                                                                                                   |
| Target      | **Any home automation user**, not a niche. The message must hold in one sentence for a beginner and for a Home Assistant regular.                                                                                               |
| Market      | **French and English in parallel.** Doubles content and moderation load; keep few pages.                                                                                                                                        |
| Time        | About 2 hours a week, more at the start.                                                                                                                                                                                        |
| Public demo | **Not a launch gate.** Launch with a video and screenshots from the local demo; `demo.sowel.org` is a second wave.                                                                                                              |
| Voice       | **Mixed**: site and docs in the name of Sowel; background pieces (real case, method) signed by the maintainer.                                                                                                                  |
| Promise     | **Axis fixed on 2026-11-15** (see « Message architecture » and [pitch.md](pitch.md)): Sowel knows your home, so it runs itself and is set up in a few clicks. The wording is still read by about five people before the launch. |

## Message architecture (maintainer, 2026-11-15)

One message. Everything else is a corollary of it, never a second headline. The reference text is the French
pitch in [pitch.md](pitch.md); every storefront (GitHub, README, site, video) is cut from it.

**Promise.** Sowel knows your home: it runs itself, is set up in a few clicks, and your data stays at home.

**The core idea: everything starts from the home's topology.** The user first describes the home (floors, rooms,
garden, garage), then places each equipment where it really is. An equipment rests on one or more devices (« a
device is what is on the network, an equipment is what is in the room »). The topology says _where_ each
equipment is, the data model says _what_ it is (about thirty equipment types, each with what it measures and
what it accepts). Integrations adapt to the model, never the reverse. This is what sets Sowel apart from Home
Assistant: domain knowledge, not a longer feature list.

**What follows from it, in the order of the pitch:**

1. Rooms that know: zone aggregation in the core (average temperature and humidity, luminosity, presence and
   since when, open doors and windows, leak, smoke, lights on, shutters and their average position, power),
   zone commands, nested zones, modes over the whole home. Automatic, nothing to configure.
2. Integrations: about twenty, and the list grows with real users' needs; installed from the app.
3. Recipes: placed on a room, they already know its equipments; each is a real program (preheat, cocoon, manual
   override, rain skip, runtime guard), far beyond an if-this-then-that rule or a blueprint. Energy is the
   strongest proof: the arbiter sends the solar surplus to the water heater then the car, with no rule to write.
4. AI: today a user who is not a developer can create a recipe with an AI assistant, because Sowel presents a
   well-described home rather than thousands of entities. A dedicated tool will simplify it later.
5. Guarantee, edge first: runs at home, no account, no Sowel cloud, no telemetry, data stays at home; plugins
   checked before install.

**Wording rules.**

- « natively, with nothing to configure », never « unique » (not checked against community solar projects).
- AI: « possible today with an AI assistant »; no « one-click generator » until the tool exists.
- Privacy: « no Sowel cloud, no telemetry, your data stays at home », never « no network traffic ». Cloud-only
  hardware talks to its vendor, notifications go through the channel the user picks, plugin and update checks
  read GitHub.
- Plugins are hash-checked (spec 089) and scoped (spec 111): never « sandboxed ».
- « about twenty integrations », not an exact count that ages (one of them is the demo simulator).
- The energy figure comes from the maintainer's home in step 3; the maintainer decides what is shown.

**Shown, not stated.** « A few clicks » is demonstrated end to end, from install to a first recipe running. Step
1's clean-machine test also times it.

## Non-Goals

- No change to the product, the API or the plugins for the sake of communication. Anything the showcase needs
  that the product lacks is done in the showcase, or becomes an ordinary issue on its merits (same rule as the
  demonstrator).
- No telemetry. The « no telemetry » promise stays; measurement uses public counters.
- No paid acquisition, no hosted offer.

## The plan

Each step is its own branch, PR and, when it adds code, its own spec. The showcase lives in a **separate
repository** (`sowel-site`), like the demonstrator, so that it does not follow the core's release cycle.

### Step 0 — Identity: a better logo

Goal: a mark that works at 16 px (favicon, tab), on dark and light, in one colour, and as a larger lockup with
the wordmark. Deliverables: 3 to 4 directions drawn to scale and compared in context (tab, app icon, header,
social card), one chosen by the maintainer, then the full export set. The product palette stays
(`#1A4F6E`, amber `#F2C035` for « on » only); the face (smile, eyes) is kept or dropped on its merits, not by
default. The change reaches the app, the PWA icons and the docs in one coordinated PR after the choice.

### Step 1 — Hygiene (weeks 1 and 2)

- Retake the screenshots after the refresh (#1127); fix the French navigation labels.
- GitHub: description, topics, homepage URL, social preview image; Discussions on; issue templates.
- README rewritten as a storefront (promise, screenshot, one install command, three links).
- Dropped (2026-11-21, maintainer): the short `sowel.org/install.sh` (Cloudflare record and redirect). The long
  `raw.githubusercontent.com` command works and stays; the short URL is polish, not a launch gate.
- Install on a clean machine, following only the public pages; fix whatever fails. A launch spends its one
  chance on the first install.

### Step 2 — Showcase (weeks 2 to 5)

- `sowel-site`: one bilingual page: promise, video, install, community links. It is built and live at
  https://sowel.org. The comparison with Home Assistant and Jeedom was dropped by the maintainer.
- `docs.sowel.org` is the plain manual again: the scroll-flip landing (`docs/stylesheets/extra.css`,
  `docs/javascripts/landing.js`) is retired, the home page is a short list of entry cards, and the Material theme
  uses the showcase site's tokens (ocean blue, one mid-blue accent, night header, light and dark).

### Step 3 — Proof (weeks 3 to 6)

- A 60 to 90 second video on the local demo.
- One real, numbered case (solar surplus arbitration). The data comes from a family home: the maintainer decides
  what is shown.
- Two short articles, FR and EN; one is « The Sowel Method » (made indexable, with its own page on the site).

### Step 4 — Launch (week 7, staggered)

One channel every two or three days so each can be answered: French (HACF forum, LinuxFR, domotics forums as
feedback posts, not adverts), English (r/selfhosted, r/homeautomation, Show HN), both (awesome-selfhosted PR).

### Step 5 — Upkeep (continuous, about 2 hours a week)

Reply within 24 hours, one piece a month tied to the release notes, `demo.sowel.org` as the second wave.

## Measures

Public counters only: image pulls (ghcr), release downloads, repository views and stars, Discussions threads,
privacy-friendly page counter on the site. Targets are set after four weeks of baseline from the figures above,
not guessed now.

## Risks

- A wide target and two languages dilute the message and double the writing: keep few pages and one promise.
- Without the public demo the video carries the launch: it must be good.
- A traffic spike on a fragile first install: step 1's clean-machine test is a gate for step 4.

## Open points

- Promise wording: read by about five people (the axis is fixed, see « Message architecture »).
- Community channel beyond GitHub Discussions (Discord or none).
- Site stack for `sowel-site` (decided in its own spec).
