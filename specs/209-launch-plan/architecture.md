# Spec 209 — Architecture

No product code changes. This spec fixes where each piece of the launch lives, so later specs do not reopen it.

## Where things live

| Piece                                                           | Home                                                                           | Why there                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Logo and brand                                                  | This repository (spec 210, `ui/src/lib/logo.ts`)                               | The app, PWA icons and docs already carry it; one drawing, drift-tested.                |
| Manual, developer docs, specs                                   | This repository, `docs/`, served at `docs.sowel.org`                           | Versioned with the code; `docs.yml` deploys on every push touching `docs/**`.           |
| Showcase (promise, video, install, comparison, community links) | New repository `sowel-site`, specified there first                             | Must not follow the core's release cycle; same split as the demonstrator.               |
| Public demo                                                     | `sowel-showroom` (second wave, `demo.sowel.org`)                               | Decisions already taken in its project map; not a launch gate.                          |
| Short install URL                                               | Cloudflare (`sowel.org` record, `install.sh` redirect)                         | Outside the repository; the landing uses the `raw.githubusercontent.com` URL meanwhile. |
| Repository storefront                                           | `README.md`, GitHub description, topics, homepage, social preview, Discussions | First thing a visitor from GitHub sees.                                                 |

## Boundaries

- The showcase reads public facts only (releases, registry, counters). It adds no endpoint to the product.
- `docs.sowel.org` keeps the manual role. The scroll-flip landing (`docs/stylesheets/extra.css`,
  `docs/javascripts/landing.js`) is retired only once `sowel-site` replaces it.
- Measurement uses public counters (ghcr pulls, release downloads, repository views and stars, Discussions,
  a privacy-friendly page counter on the site). No telemetry in the product.

## File changes in this repository for this spec

- `specs/209-launch-plan/{spec,architecture,plan}.md`
- A row in `docs/specs-index.md` and `docs/specs-index.fr.md`

Each later step is its own branch and PR, and its own spec when it adds code.
