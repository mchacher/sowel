# Architecture: Dark Mode

## Approach

Tailwind `class` strategy: adding `class="dark"` on `<html>` triggers `.dark {}` CSS variable overrides. All components already use semantic tokens (`bg-surface`, `text-text`, `border-border`), so zero component changes needed for color adaptation.

## Data Model Changes

- `UserPreferences.theme?: "light" | "dark" | "system"` — both backend (`src/shared/types.ts`) and frontend (`ui/src/types.ts`)

## CSS Changes

- `.dark {}` block in `ui/src/index.css` overriding all `--color-*` and `--shadow-*` variables
- Fix `border: 2px solid white` → `border: 2px solid var(--color-surface)` on slider thumbs

## Theme Initialization

- `ui/src/main.tsx`: read `localStorage("sowel_theme")` before React render, apply `dark` class immediately to prevent flash
- System detection: `window.matchMedia("(prefers-color-scheme: dark)")` listener

## UI Changes

- `SettingsPage.tsx`: add theme toggle (Light/Dark/System) in PreferencesSection, same pattern as language selector

## File Changes

| File                            | Change                                 |
| ------------------------------- | -------------------------------------- |
| `src/shared/types.ts`           | Add `theme?` to `UserPreferences`      |
| `ui/src/types.ts`               | Add `theme?` to `UserPreferences`      |
| `ui/src/index.css`              | Add `.dark {}` block, fix slider thumb |
| `ui/src/main.tsx`               | Theme initialization before render     |
| `ui/src/pages/SettingsPage.tsx` | Theme toggle in Preferences section    |
| `ui/src/pages/HomePage.tsx`     | Fix hardcoded hover colors             |
| `ui/src/i18n/locales/en.json`   | Theme translation keys                 |
| `ui/src/i18n/locales/fr.json`   | Theme translation keys                 |
| `docs/design-system.md`         | Dark mode palette documentation        |
