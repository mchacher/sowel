# Components

> Every component used in the Sowel zone view, with a one-line summary and a link to its full spec.

The system has **two component layers**:

- **Atoms** — visual primitives (pill, chip-state, badge, power-btn, toggle). Used everywhere.
- **Patterns** — composed structures (panel, eq-row, modal). Built from atoms and layout primitives.

---

## Atoms

| Component        | Purpose                                                                                    | Spec                                                     |
| ---------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Pill**         | Content-width chip with icon + value, sometimes a sparkline. Used in the strip and topbar. | [components/pill.md](components/pill.md)                 |
| **Chip-state**   | Compact text badge for a state (`RAS`, `Détecté 24s`, `Ouvert`, `Fermé`, `Actif`).         | [components/chip-state.md](components/chip-state.md)     |
| **Power-button** | 32×26 rounded square button for on/off equipment commands. Has `--on` variant.             | [components/power-button.md](components/power-button.md) |
| **Toggle**       | 30×18 pill switch for recipe enable/disable.                                               | [components/toggle.md](components/toggle.md)             |
| **Slider**       | Horizontal track + filled bar + knob for dimmer / shutter position.                        | [components/slider.md](components/slider.md)             |
| **Shutter-grp**  | Segmented control of 3 buttons (↑ ■ ↓) for shutter open/stop/close.                        | [components/shutter-grp.md](components/shutter-grp.md)   |

---

## Patterns

### Layout

| Component         | Purpose                                                                                                                     | Spec                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Panel**         | Card container for a top-level section (Équipements, Comportements, Activité). Has a tinted head + body with rows.          | [components/panel.md](components/panel.md)                 |
| **Cat-head**      | Sub-category header inside a panel (Éclairages, Modes, Recettes). Neutral background, optional `+` button.                  | [components/cat-head.md](components/cat-head.md)           |
| **Hero**          | Zone title block — title + lead synthesizing state. Lives above the strip.                                                  | [components/hero.md](components/hero.md)                   |
| **Strip**         | Horizontal row of state pills with three soft groups (sensors / counters / alerts). Stays single-line, scrolls if overflow. | [components/strip.md](components/strip.md)                 |
| **Zone commands** | Inline toolbar below the strip with 5 icon buttons (lights on/off + shutter ↑■↓).                                           | [components/zone-commands.md](components/zone-commands.md) |

### Rows (equipment, mode, recipe)

All three row types share a **3-column grid** with a 32×32 icon, 1fr name, and right-aligned controls. They all measure **52 px tall** for visual alignment between panels.

| Component         | Specifics                                                                                                   | Spec                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **eq-row**        | Equipment row: icon + name + slider + value + power-btn. Variants per type (light, shutter, sensor, media). | [components/eq-row.md](components/eq-row.md)               |
| **mode-row**      | Mode row: icon + status dot overlay + name/meta + Apply button or "Actif" badge.                            | [components/mode-row.md](components/mode-row.md)           |
| **recipe-row**    | Recipe row: icon + name + toggle on row 1, three small action icons (logs, dup, del) on row 2.              | [components/recipe-row.md](components/recipe-row.md)       |
| **activity-item** | Activity feed entry: time + colored dot + text + optional meta.                                             | [components/activity-item.md](components/activity-item.md) |

### Navigation

| Component          | Purpose                                                                                                    | Spec                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Sidebar nav**    | Vertical nav with item pills, expand chevrons for sub-zones, separator rules around Modes/Analyse/Énergie. | [components/sidebar-nav.md](components/sidebar-nav.md)     |
| **Topbar**         | Horizontal header with breadcrumb, time chip, sunlight chip, connection status, alarms, avatar.            | [components/topbar.md](components/topbar.md)               |
| **Mobile tab bar** | Bottom navigation: Dashboard / Maison / Énergie / Modes / Plus.                                            | [components/mobile-tabbar.md](components/mobile-tabbar.md) |

### Overlays

| Component               | Purpose                                                                                                                                   | Spec                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Modal — recipe edit** | Centered card with header, scrollable body (sections: checklist / form grid / plages / mode overrides), footer with status + Save/Cancel. | [components/modal.md](components/modal.md) |

### Dashboard

| Component            | Purpose                                                                                                                                               | Spec                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Dashboard widget** | Large 273×240 card with title, line-art illustration, and a state/controls footer. One widget per equipment, hand-picked for the user's daily glance. | [components/dashboard-widget.md](components/dashboard-widget.md) |

---

## Equipment type coverage

Sowel supports 21 equipment types. They all reduce to **6 canonical patterns** below, demonstrated in the `specs/094-ui-redesign/mockups/ui-redesign-B-polished.html` "Patterns d'équipements" section.

| Pattern                             | Maps to types                                                                                                                                  | Layout                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Power-only**                      | `light_onoff`, `switch`, `appliance`                                                                                                           | icon + name + power-btn                         |
| **Power + slider**                  | `light_dimmable`, `light_color`, `water_valve`                                                                                                 | icon + name + slider + value + power-btn        |
| **Slider + state + 3-button group** | `shutter`, `pool_cover`                                                                                                                        | icon + name + slider + chip-state + shutter-grp |
| **Single toggle command**           | `gate`                                                                                                                                         | icon + name + chip-state + gate-cmd button      |
| **Target + adjust**                 | `thermostat`, `heater`, `pool_heat_pump`                                                                                                       | icon + name + current + target± + power-btn     |
| **Read-only multi-value**           | `sensor`, `button`, `weather`, `weather_forecast`, `energy_meter`, `main_energy_meter`, `energy_production_meter`, `pool_pump`, `media_player` | icon + name + value(s) + chip-state             |

Any new equipment type should map cleanly to one of these six. If none fits, the new pattern is added as a spec **and** documented as a new line above.

---

## Component lifecycle

A component is **proposed** in this file (one-liner + link), **drafted** in its own file under `components/`, **adopted** when at least one production surface ships with it, and **deprecated** by marking the spec header and adding a replacement link.

State of v1.0:

- All atoms above are **adopted** in the polished.html reference.
- Component specs are being written progressively. Until the spec exists, the polished.html serves as authoritative reference.
