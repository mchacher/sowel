# Winch Design System

## Typography

| Usage       | Font           | Size                 |
| ----------- | -------------- | -------------------- |
| Body        | Inter          | 14px                 |
| Data values | JetBrains Mono | 28px (lg), 20px (md) |

## Colors

### Core Palette

| Token           | Hex       | Usage                                       |
| --------------- | --------- | ------------------------------------------- |
| `primary`       | `#1A4F6E` | Buttons, links, shutters, sensors           |
| `primary-hover` | `#13405A` | Interactive hover state                     |
| `primary-light` | `#E6F0F6` | Light primary backgrounds                   |
| `accent`        | `#D4963F` | Recipes, weather outdoor, integration icons |
| `accent-hover`  | `#BB8232` | Accent hover state                          |

### Semantic Colors

| Token         | Hex       | Usage                                                   |
| ------------- | --------- | ------------------------------------------------------- |
| `active`      | `#EAB308` | Light ON state (dot indicator, slider thumb)            |
| `active-text` | `#A16207` | Light ON text, motion detected, doors/windows open      |
| `success`     | `#3D8B6E` | Connected status, modes header, enabled badge           |
| `warning`     | `#C88B3A` | Ignition/stabilizing, comfort mode, log warnings        |
| `error`       | `#C0453A` | Errors, thermostat/climate header, disconnected, alarms |

### Neutral Colors

| Token            | Hex       | Usage                          |
| ---------------- | --------- | ------------------------------ |
| `background`     | `#F8FAFB` | Page background                |
| `surface`        | `#FFFFFF` | Cards, panels                  |
| `text`           | `#1A1A1A` | Primary text                   |
| `text-secondary` | `#6B7280` | Secondary text                 |
| `text-tertiary`  | `#9CA3AF` | Tertiary text, inactive states |
| `border`         | `#E1E6EA` | Card borders                   |
| `border-light`   | `#EDF0F3` | Dividers, subtle borders       |

## Section Headers (Zone Cards)

| Section  | Background           | Icon Color            |
| -------- | -------------------- | --------------------- |
| Lights   | `bg-active/8`        | `text-active-text`    |
| Shutters | `bg-primary/6`       | `text-primary`        |
| Climate  | `bg-error/6`         | `text-error`          |
| Sensors  | `bg-primary/6`       | `text-primary`        |
| Weather  | `bg-primary/6`       | `text-primary`        |
| Other    | `bg-text-tertiary/6` | `text-text-secondary` |
| Modes    | `bg-success/8`       | `text-success`        |
| Recipes  | `bg-accent/8`        | `text-accent`         |

## Spacing & Radius

| Token       | Value         |
| ----------- | ------------- |
| Base unit   | 4px           |
| `radius-sm` | 6px (buttons) |
| `radius-md` | 10px (cards)  |
| `radius-lg` | 14px (modals) |

## Icons

- Library: **Lucide React**
- Stroke width: **1.5px**
- Sizes: 14px (inline), 16-18px (card icons), 22px (page headers)

## Logo

Winch logo: white drum + crank on `primary` rounded square. Drum centered at (16,16) in a 32x32 viewBox.

## Shadows

| Token       | Light                         | Dark                          |
| ----------- | ----------------------------- | ----------------------------- |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`  | `0 1px 2px rgba(0,0,0,0.20)`  |
| `shadow-md` | `0 2px 8px rgba(0,0,0,0.08)`  | `0 2px 8px rgba(0,0,0,0.30)`  |
| `shadow-lg` | `0 8px 24px rgba(0,0,0,0.12)` | `0 8px 24px rgba(0,0,0,0.40)` |

## Dark Mode

### Strategy

- **Tailwind `class` strategy**: `class="dark"` on `<html>` activates `.dark {}` CSS variable overrides in `ui/src/index.css`
- **User preference**: Light / Dark / System — stored in `UserPreferences.theme` and `localStorage("winch_theme")`
- **System detection**: `prefers-color-scheme: dark` media query, with live listener for "system" mode
- **No component changes**: all components use semantic tokens (`bg-surface`, `text-text`, `border-border`) — only CSS variables change

### Dark Palette (Deep Navy Slate)

| Token            | Light     | Dark      | Rationale                                 |
| ---------------- | --------- | --------- | ----------------------------------------- |
| `primary`        | `#1A4F6E` | `#4A9FCC` | Same hue, raised luminosity for dark bg   |
| `primary-hover`  | `#13405A` | `#5CB3E0` | Lighter on hover (dark = brighter)        |
| `primary-light`  | `#E6F0F6` | `#1A2E42` | Active nav / selection background         |
| `accent`         | `#D4963F` | `#E0A84F` | Slightly brighter amber                   |
| `accent-hover`   | `#BB8232` | `#EBB85F` | Brighter on hover                         |
| `background`     | `#F8FAFB` | `#111827` | Deep navy, warmer than pure gray          |
| `surface`        | `#FFFFFF` | `#1E293B` | Slate-blue cards, clear elevation         |
| `surface-raised` | `#FFFFFF` | `#253040` | Modals, dropdowns, third elevation level  |
| `text`           | `#1A1A1A` | `#E8EAED` | Off-white, reduces glare                  |
| `text-secondary` | `#6B7280` | `#94A3B8` | Slate-tinted, readable on navy            |
| `text-tertiary`  | `#9CA3AF` | `#64748B` | Muted slate, maintains 3-tier hierarchy   |
| `border`         | `#E1E6EA` | `#2D3A4F` | Blue-tinted border, subtle but visible    |
| `border-light`   | `#EDF0F3` | `#253040` | List separators, dividers                 |
| `active`         | `#FACC15` | `#EAB308` | Yellow stays as-is, signature for lights  |
| `active-text`    | `#A16207` | `#FDE68A` | Light yellow text for readability on dark |
| `success`        | `#3D8B6E` | `#5BB98C` | Brighter green                            |
| `warning`        | `#C88B3A` | `#E0A84F` | Slightly brighter amber                   |
| `error`          | `#C0453A` | `#E05A50` | Brighter red, alarming not neon           |

### Design Considerations

- **Opacity-based backgrounds** (`bg-active/8`, `bg-primary/6`, `bg-error/6`) adapt automatically since the base color changes
- **Slider thumb border** uses `var(--color-surface)` instead of hardcoded `white` to adapt
- **Zone command hover states** use semantic tokens (`hover:bg-active/8`, `hover:bg-primary/6`) instead of hardcoded Tailwind colors
- **Logo**: uses `--color-primary` for background, so it adapts automatically (light ocean blue → brighter sky blue)
