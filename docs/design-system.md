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

| Token       | Value                         |
| ----------- | ----------------------------- |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`  |
| `shadow-md` | `0 2px 8px rgba(0,0,0,0.08)`  |
| `shadow-lg` | `0 8px 24px rgba(0,0,0,0.12)` |
