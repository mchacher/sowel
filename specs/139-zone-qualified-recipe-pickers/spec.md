# Spec 139 — Zone-qualified equipment pickers in recipe forms

## Context

Recipe forms select equipments either through a zone dropdown followed by an
equipment dropdown (`SingleEquipmentZonePicker`, `EquipmentListPicker`) or
through a flat list of equipment options. Both paths flatten the zone tree to
`{ id, name }` (`ZoneRecipesSection.tsx` L464, L1176, L1707), so only the leaf
name survives.

In any house that repeats a room name across floors or buildings — a bathroom
in the main house, another in a guest wing, a WC on each floor — the zone
dropdown lists `Salle de bain` several times with nothing to tell them apart.
Several equipment renderers make it worse by showing the bare equipment name
with no zone at all, and sensors delivered by an integration usually share a
generic name (`Température`, `Présence`) across the whole installation.
Reported in #385: a user with three `Salle de bain` zones and twelve
`Température` sensors cannot configure a recipe at all.

The rest of the UI does not have this problem because it renders zones
hierarchically (`SidebarZoneTree`, `ZoneTree`, dashboard widgets). Two places
already build a qualified label ad hoc:

- `AnalyseView.flattenZones()` accumulates `${parentName} › ${z.name}`.
- `AppLayout.TopbarBreadcrumb` joins crumbs with `›` and treats the root zone
  as implicit ("Home › … › CurrentZone").

This spec turns that ad-hoc convention into one shared helper and applies it to
the recipe pickers.

## Goals

1. Every zone shown in a recipe form is distinguishable from the zones sharing
   its name.
2. Every equipment option or row whose name repeats in its list is qualified by
   the zone that separates it.
3. Labels stay as short as the ambiguity demands — a compact dropdown truncates
   whatever it cannot fit, so a full path would trade one unusable label for
   another.
4. The path convention (`›` separator, implicit single root) has one
   definition, reused instead of re-derived per component.

## Non-Goals

- No change to zone data, API payloads, or the `zones` store — this is a
  presentation concern computed from the tree already held in the client.
- No change to which equipments a slot offers: `crossZone` and
  `includeDescendants` (spec 092) keep deciding the candidate set. This spec
  only changes how a candidate is labelled.
- No renaming of zones or equipments, and no new naming constraint. Duplicate
  names stay legal; the UI stops depending on them being unique.
- No new i18n strings — a path is data, assembled from zone names the user
  chose.

## Functional Requirements

### FR1 — Minimally qualified zone labels

A new UI helper flattens the zone tree into `{ id, name, label, chain, path,
depth }`.

- `label` is the **shortest ancestor suffix that separates a zone from the
  zones sharing its name**: the bare name when it is unique, `RDC › Salle de
bain` when a single ancestor is enough, more only where the tree repeats
  itself deeper. Every member of a name group gets the same number of segments,
  so their labels compare visually.
- When the tree has exactly **one** root, that root is dropped from the chains:
  it is the whole installation and carries no information (same reasoning as
  the breadcrumb's implicit root). The root's own label stays its name, so it
  never renders empty. With several roots, chains are complete.
- `chain` (ancestors, outermost first) and `path` (the chain joined) are kept
  for callers that need the whole thing.
- Order stays depth-first, matching the tree, so a dropdown reads top-down.

### FR1b — Equipment labels qualified against their own candidates

A second helper labels a list of equipment candidates: bare name when unique in
that list, `name — zone` when not, where the zone qualifier is the shortest
suffix separating **those candidates** — not every zone in the house. Three
ventilations in three plainly different rooms only need the room name, however
deep those rooms sit.

Two equipments sharing a name _and_ a zone remain identical: nothing but a
rename separates them, and an index would look like information without being
any.

### FR2 — Recipe pickers use the qualified path

In `ZoneRecipesSection.tsx`:

- The three zone flattenings use the helper.
- Both zone dropdowns (`SingleEquipmentZonePicker`, `EquipmentListPicker`) and
  the duplicate-instance target-zone dropdown render `label`.
- The selected-equipment chip in `EquipmentListPicker` shows `label` instead of
  the leaf name.
- The five bare equipment `<option>` renderers share one `EquipmentOptions`
  component built on FR1b, and the two duplicated checkbox lists collapse into
  one `EquipmentCheckboxList` that shows the qualifier as secondary text.
- Equipment dropdowns _inside_ a zone picker keep bare names: the zone was just
  chosen one control to the left, so repeating it would be noise.
- An equipment whose zone is not in the tree keeps rendering its name alone.

### FR3 — `AnalyseView` adopts the helper

`AnalyseView.flattenZones()` is replaced by the shared helper (its `depth`
field is kept, it drives the option indentation). Visible effect: analysis zone
labels lose the redundant root prefix, matching the breadcrumb.

## Acceptance Criteria

- [x] In an installation with several same-named rooms, every zone dropdown in a
      recipe form shows a distinct label.
- [x] An equipment name repeated in a list is qualified by the zone; a unique
      name is left alone.
- [x] Labels carry no more ancestors than the ambiguity requires.
- [x] A single root zone is absent from descendant labels; with several roots
      every label is complete.
- [x] `AnalyseView` uses the shared helper and no local flattening remains.
- [x] Unit tests cover single root, multiple roots, homonymous leaves, deeper
      walk-up, unseparable twins, depth, order, empty tree, and the equipment
      labelling (unique, repeated, orphan zone, same name and zone).
- [x] `npx tsc --noEmit`, `cd ui && npx tsc -b --noEmit`, `npx vitest run`,
      `npx eslint src/ --ext .ts` and `cd ui && npx eslint .` all pass.

## Edge Cases

- **Empty tree** — helper returns `[]`; dropdowns render their placeholder as
  they do today.
- **Single root, no children** — the root's path is its own name.
- **Zone name already containing `›`** — rendered verbatim, no escaping. A
  label stays readable and no parsing depends on the separator.
- **Homonyms that no suffix separates** (same names all the way up) — the label
  falls back to the whole chain rather than looping.
- **Equipment referencing a deleted zone** — no entry in the map, the name
  renders alone rather than `name — undefined`.
- **Deep trees** — the full chain is rendered; `<option>` text is not truncated
  by the design system, and the checkbox rows already `truncate`.
- **Long labels on mobile** — the equipment name comes first in every renderer,
  so truncation eats the least significant end. This is why labels are
  minimal: the first `<select>` in a 3-column grid is ~120 px wide, and a full
  path there reads `VMC — M…`.
