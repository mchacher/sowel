# Spec 208 — Equipment families: grouping, colours, bottom bar

## Context

After the spec 196 refresh the maintainer found the app dull on desktop and PWA (2026-11-12). Over three
days of mockups on the real production pages (design canvas
https://claude.ai/artifact/BUmjtmY4LpPbTJaTJiiS12, boards X and Y0–Y7) he chose:

- colour **by equipment family**, not by state, carried by the section title and the row tiles (variant
  « B2 »);
- a rigorous grouping with one name per family, used everywhere (« Volets » becomes « Ouvrants »);
- sensors get a colour of their own;
- a tile that is running takes the full colour of its family (today's lit-light behaviour, extended);
- a bottom tab bar whose selection can be seen.

On 2026-11-14 he approved every recommendation of boards Y0–Y7: Ouvrants in indigo, Climat in brick, a
Water family, the filled tile when running.

Spec 196 (slice 7c) had decided « one neutral header per category, no per-group tint » and
`design-system/tokens.md` §1.5 forbade tinting category headers. This spec reverses both, on the maintainer's
explicit decision.

## Goals

1. Every equipment type belongs to one **family** or one **neutral section**, by one rule: the family of what
   the equipment acts on or measures.
2. The Maison view groups equipments by family: 19 sections become 11, each named after its family.
3. Each family has a colour (pale, ink, fill) in light and dark, distinct from the colour roles.
4. A switch (plug or relay) can be given a family, so a plug that drives a radiator sits in Climat.
5. The bottom tab bar shows which tab is selected.

## Non-Goals

- Dashboard widgets and their illustrations (they keep amber when on).
- The desktop sidebar.
- The Equipments admin page layout (grouped by zone, unchanged); only its icon colours follow the families.
- Zone pills, bulk actions, recipes, modes, activity: unchanged.
- No family on a type other than `switch` (every other type has one fixed family).

## Functional Requirements

### FR1 — Families and sections

Rule: an equipment belongs to the family of what it acts on or measures.

| Section (FR / EN)           | Family     | Types                                                                                                                  |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Éclairages / Lights         | `lighting` | `light_onoff`, `light_dimmable`, `light_color`                                                                         |
| Ouvrants / Openings         | `openings` | `shutter`, `awning`, `door`, `gate`, `pool_cover`                                                                      |
| Climat / Climate            | `climate`  | `thermostat`, `heater`, `vmc`                                                                                          |
| Eau / Water                 | `water`    | `water_valve`, `pool_pump`, `pool_heat_pump`, `water_heater`                                                           |
| Énergie / Energy            | `energy`   | `main_energy_meter`, `energy_meter`, `energy_production_meter`, `solar_panel`, `ups`, `ev_charger`, `electric_vehicle` |
| Capteurs / Sensors          | `sensors`  | `sensor`, `weather`, `weather_forecast`, `camera`                                                                      |
| Multimédia / Media          | none       | `media_player`                                                                                                         |
| Électroménager / Appliances | none       | `appliance`                                                                                                            |
| Prises / Plugs              | none       | `switch` without a family                                                                                              |
| Commandes / Controls        | none       | `button`                                                                                                               |
| Afficheurs / Displays       | none       | `display`                                                                                                              |

Sections appear in this order, empty ones hidden. Edge choices: the water heater and the pool heat pump heat
water (Water); the charger and the vehicle store and draw energy (Energy); a camera observes (Sensors); a button
is a control, not a measure (neutral).

### FR2 — Colours

Each family has four tokens per theme: `pale` (tile and title chip at rest), `ink` (title and icon), `fill`
(tile when running) and `on` (icon on the fill).

| Family   | Pale (light / dark)   | Ink (light / dark)    | Fill (light / dark)   | On (light / dark)     |
| -------- | --------------------- | --------------------- | --------------------- | --------------------- |
| lighting | `#FFF3CC` / `#372A16` | `#8A6100` / `#F2BC6E` | `#F2C035` / `#F2BC6E` | `#1C1A14` / `#1C1A14` |
| openings | `#E7EBF8` / `#212949` | `#3D55A3` / `#A3B3F0` | `#4F67BA` / `#7F95E0` | `#FFFFFF` / `#0E191F` |
| climate  | `#FBE7DF` / `#3E241B` | `#A8441C` / `#F0936B` | `#C4572E` / `#E07A52` | `#FFFFFF` / `#0E191F` |
| water    | `#DDF3F1` / `#10302D` | `#00756B` / `#5FC9BC` | `#00867A` / `#3DAA9E` | `#FFFFFF` / `#0E191F` |
| energy   | `#E3F2E7` / `#16301E` | `#1E7B34` / `#74C77F` | `#2D8F3E` / `#4CA85C` | `#FFFFFF` / `#0E191F` |
| sensors  | `#EEE8F8` / `#2F2545` | `#6A4BA6` / `#B9A3EC` | `#7C61A8` / `#9A82D6` | `#FFFFFF` / `#0E191F` |

Lighting is the amber role: its fill is `--a-500`, its ink `--a-ink`. Energy is the solar green of the energy
palette. Neutral sections have no colour: their tiles are `border-light` with the secondary text colour.

### FR3 — Section header

The section title and its icon take the family ink; the icon sits on a 26 px square of the family pale with the
6 px control radius. A neutral section keeps today's header.

### FR4 — Tiles

An equipment tile (Maison rows, the Equipments admin page, the equipment page header) takes the pale and ink of
its family at rest, and the fill and on colours when the equipment is **running**:

| Type                                                         | Running when                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| lights, `switch`, `water_valve`, `pool_pump`, `water_heater` | the on/off state is on                                                     |
| `heater`                                                     | in comfort (pilot wire: relay off, or no state reading), as its badge says |
| `thermostat`                                                 | its power is on                                                            |
| `pool_heat_pump`                                             | its mode is not `OFF`                                                      |
| `vmc`                                                        | its speed is not off                                                       |
| `ev_charger`                                                 | it is charging                                                             |
| `electric_vehicle`                                           | it is charging                                                             |
| everything else                                              | never                                                                      |

The on/off state is read as the controls read it (`relayStateOn`: `true` or « ON » in any case). A lit light keeps
its glow. A neutral tile never changes: the state is read on the controls (the amber power
button) and the pills, as today. An offline row keeps its 55 % opacity over the family pale.

### FR5 — A family for a plug

`Equipment.family` (`lighting` … `sensors`, or `null`) is stored on the equipment and settable through
`PUT /api/v1/equipments/:id` only for a `switch`; any other type answers 400 when a non-null family is sent.
The equipment page of a switch offers a **Family** setting (admin only), « None (Plugs) » by default. A switch
with a family is shown, coloured and counted in that family's section.

### FR6 — Names

- Section labels as in FR1, in FR and EN; the 19 `equipments.group.*` keys are replaced by
  `equipments.family.*` and `equipments.section.*`.
- Type labels: `gate` « Portail » (was « Ouvrant », which is now the family), `switch` « Prise ou relais » / « Plug
  or relay », `button` « Bouton ou télécommande » / « Button or remote ».

### FR7 — Bottom tab bar

On phones and tablets (below `lg`): each tab's icon is 22 px in a 56 × 30 px area; the selected tab paints that
area as a pill of the primary ink at 15 %, its icon stroke goes to 2 and its label to semibold; the other tabs
are secondary text. The bar is 60 px high before the safe area.

## Acceptance Criteria

- [x] Every `EquipmentType` maps to exactly one section; the mapping is the FR1 table (test).
- [x] The Maison view shows one section per family or neutral section, in FR1 order, titled and coloured as FR3.
- [x] Tiles follow FR4 at rest and when running, in Maison, the Equipments page and the equipment page header.
- [x] Family tokens exist in both themes; ink ≥ 4.5:1 on the card and on the pale, the on colour ≥ 3:1 on the
      fill, the dark pale ≥ 1.1:1 on the dark card (test).
- [x] `family` is stored (migration 045), returned, settable on a switch, refused on another type, cleared by
      `null` (tests).
- [x] A switch with a family appears in that family's section with its colours.
- [x] FR6 labels in FR and EN.
- [x] The bottom bar shows the selected tab as FR7.
- [x] Design system (`tokens.css`, `tokens.md`, `cat-head.md`, `eq-row.md`, `mobile-tabbar.md`) and docs updated.

## Edge Cases

- Unknown type from a newer backend: the row goes to a trailing neutral « Autres » / « Other » section
  (`equipments.section.other`), with a neutral tile.
- A switch whose family is later cleared goes back to Plugs.
- A family stored on a non-switch (impossible through the API, possible by hand in SQLite) is ignored by the UI.
- Equipment with no state binding: never running, pale tile; except a heater, whose badge then reads « Confort »
  and whose tile fills with it.

## Docs Delta

| Page (EN and FR)                                                                                                                        | Change                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/user/zones.md` + `.fr.md`                                                                                                         | Equipments grouped by family, colours, running tile                            |
| `docs/user/equipments.md` + `.fr.md`                                                                                                    | Families table, type labels, the Family setting of a plug                      |
| `docs/user/getting-started.md` + `.fr.md`                                                                                               | « grouped by type » becomes « grouped by family »                              |
| `docs/technical/api-reference.md` + `.fr.md`                                                                                            | `PUT /equipments/:id` accepts `family`                                         |
| `docs/technical/data-model/equipments.md` (EN only, no FR page)                                                                         | `equipments.family` column (migration 045), `Equipment.family`, families table |
| `design-system/tokens.md`, `tokens.css`, `components.md`, `components/cat-head.md`, `eq-row.md`, `mobile-tabbar.md`, `activity-item.md` | Family tokens, coloured section header, tiles, tab bar                         |

Screenshots to retake: none mandatory; the zone screenshots in `docs/screenshots/` show the old neutral
headers and are retaken with the next documentation screenshot pass (`sowel-docs`).
