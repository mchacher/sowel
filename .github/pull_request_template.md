<!--
Describe the root cause (for a fix) or the design (for a feature), and list the
tests added. Reference the issue with `Closes #NNN` so the merge closes it.
-->

<!--
DOCUMENTATION TRAILERS (spec 167)
=================================

Two CI checks read the lines below. Delete this block if neither applies.

`Docs-Impact:` — needed when a `feat`/`fix` PR touches src/ or ui/src/ and
updates no page under docs/. State why nothing a reader can observe changed.
A bare "none" does not pass; the sentence is the point.

  Docs-Impact: none — internal refactor of the retry loop, no documented
  behaviour changes

`Docs-Parity:` — needed when you change one side of an EN/FR page pair without
the other. Name the untouched file and say why.

  Docs-Parity: docs/technical/api-reference.fr.md — typo fix in the EN copy only

A third check needs no trailer: a new `specs/NNN-name/` folder must carry a row in
`docs/specs-index.md` AND in `docs/specs-index.fr.md`. The check prints the row to paste.

All three run locally, before you push:

  bash scripts/check-docs-impact.sh
  bash scripts/check-docs-parity.sh
  bash scripts/check-specs-index.sh folders
-->
