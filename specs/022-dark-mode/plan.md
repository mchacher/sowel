# Implementation Plan: Dark Mode

## Tasks

1. [ ] Add `theme?: "light" | "dark" | "system"` to `UserPreferences` in backend and frontend types
2. [ ] Add `.dark {}` CSS variable overrides to `ui/src/index.css`
3. [ ] Fix slider thumb `border: 2px solid white` → `var(--color-surface)`
4. [ ] Add theme initialization in `ui/src/main.tsx` (localStorage + prefers-color-scheme)
5. [ ] Add theme toggle in `SettingsPage.tsx` PreferencesSection
6. [ ] Add i18n translations (en + fr) for theme settings
7. [ ] Fix hardcoded hover colors in `HomePage.tsx` zone command buttons
8. [ ] Update `docs/design-system.md` with dark mode palette
9. [ ] TypeScript compile + verify

## Testing

- Toggle between Light / Dark / System in Settings
- Verify no flash of wrong theme on reload
- Verify all pages render correctly in both modes
- Verify slider thumbs, zone command buttons, login page adapt
