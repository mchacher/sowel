# Spec 142 — Zone paths in the equipments admin list

## Context

`Administration › Équipements` (`ui/src/pages/EquipmentsPage.tsx`) lists every
equipment of the installation grouped under a zone heading. The grouping walked
the zone tree into a `zoneId → name` map, then keyed the groups by that **name**:

```ts
const name = zoneNames.get(eq.zoneId) ?? "Unknown zone";
const list = groups.get(name) ?? [];
```

Two zones sharing a name therefore collapse into a single group. In the
installation reported by the user — the same tree as spec 139, a `Salle de bain`
in the main house and one per floor of the guest wing — the page shows one
`Salle de bain` heading listing the equipments of three physically different
rooms. Nothing on screen says the list mixes them, and nothing distinguishes the
rows: an integration names every sensor `Température`, so the group reads as one
room owning several duplicate sensors.

The bug is invisible in the rest of the UI because hierarchical views render the
tree (`SidebarZoneTree`, `ZoneTree`, the `Maison` page): the shape supplies the
context that a flat list has to spell out. Spec 139 solved the same class of
problem for the compact pickers of the recipe forms and left behind
`ui/src/lib/zone-path.ts` — the zone-path convention this spec reuses.

Two smaller defects come from the same function:

- Groups are sorted alphabetically by zone name, so sibling rooms of one floor
  are scattered across the page and the order never matches the `Maison` page.
- The fallback label for an equipment whose zone is gone is a hardcoded English
  `"Unknown zone"`, untranslated (`dashboard.unknownZone` already exists).

## Goals

1. Two zones sharing a name are two groups on this page, whatever the depth or
   shape of the tree.
2. Each heading says where its zone actually is, without the reader having to
   open the `Maison` page to find out.
3. The page reads in the same order as the zone tree, so sibling rooms sit
   together.
4. The zone-path convention keeps one definition — spec 139's helper module,
   extended rather than duplicated.

## Non-Goals

- No change to zone or equipment data, API payloads, or the `zones` store. This
  is presentation computed from the tree the client already holds.
- No change to the equipment cards themselves (`EquipmentCard`), to the filter,
  or to the create-equipment flow.
- No renaming and no new uniqueness constraint on zone names. Duplicate names
  stay legal; the page stops depending on them being unique.
- No new i18n strings — a path is data, assembled from names the user chose.
- Other flat surfaces that show a bare zone name (`DeviceList` equipment cells,
  `AnalyseView` series labels, dashboard widget fallbacks) are out of scope.
  They are ambiguous but they do not _merge_ distinct zones, which is what makes
  this page misreport its content.

## Functional Requirements

### FR1 — Grouping keyed by zone identity

Equipments are grouped by `zoneId`. Each group carries the zone's flattened
`ZoneOption` (spec 139), so the renderer has the id, the name, the ancestor
chain and the depth.

### FR2 — Full path in the heading

A heading renders the zone's whole ancestor chain, ancestors muted and the
zone's own name emphasised:

```
GÎTE › ÉTAGE › SALLE DE BAIN
```

The full path is the right choice **here** and the wrong one in spec 139: a
section heading owns the page width, while the dropdown of a recipe form
truncated `Maison Principale › Maison › Salle de bain` back into uselessness.
Same convention, different room to spend it in — hence the shortest-suffix
`label` stays what the pickers use, and this page uses `chain`.

A single top-level zone is the whole installation and is dropped from the
chains, exactly as `flattenZonesWithPath` and the topbar breadcrumb already do:
`Maison › RDC › Cuisine`, not `Domaine › Maison › RDC › Cuisine`. With several
roots the top level discriminates and stays.

### FR3 — Tree order

Groups appear in depth-first tree order — the order of the `Maison` page and of
the zone tree, including the user's own `displayOrder` reordering — instead of
alphabetically by name. Equipments keep their order within a group.

### FR4 — Zones with no equipment, equipments with no zone

A zone holding no equipment (or none matching the filter) produces no heading.
An equipment whose zone no longer exists lands in a trailing group labelled with
the translated `dashboard.unknownZone` rather than being dropped from the page.

## Acceptance

- Three `Salle de bain` zones holding one equipment each render three headings,
  each with the path that separates it.
- The heading order matches a depth-first walk of the zone tree.
- An equipment pointing at a deleted zone still appears, under a translated
  "Zone inconnue" / "Unknown zone" heading, last.
- The filter keeps working: filtering hides equipments, and a zone left with no
  match loses its heading.
