# dev-notes/

Internal engineering playbooks not published to the docs site (`docs.sowel.org`).

These are procedures we run by hand on dev workstations or during incidents. They live in the repo so they are versioned alongside the code that they reference, but they are deliberately kept out of `docs/` so the mkdocs build does not surface them to users.

## Index

- [shadow-instance.md](shadow-instance.md) — running a candidate Docker build against a copy of production state without affecting production.
