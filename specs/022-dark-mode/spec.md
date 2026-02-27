# Dark Mode

## Summary

Add dark mode support to Winch UI using a deep navy slate palette. Theme is toggled from Settings > Preferences (alongside language), persisted in user preferences, and applied via Tailwind's `class` strategy on `<html>`.

## Reference

- Spec sections: §15 (Design System)
- Approved proposal: `docs/dark-mode-proposal.html`

## Acceptance Criteria

- [ ] Dark mode CSS variables override light tokens in `.dark {}` block
- [ ] Theme toggle in Settings > Preferences (Light / Dark / System)
- [ ] Theme persisted in backend UserPreferences + localStorage
- [ ] System preference detection (`prefers-color-scheme`) for "system" option
- [ ] No flash of wrong theme on page load
- [ ] Slider thumb border adapts (no hardcoded `white`)
- [ ] Zone command hover colors adapt to dark mode
- [ ] `docs/design-system.md` updated with dark mode palette

## Scope

### In Scope

- CSS variable overrides for dark theme
- Theme preference in Settings (light/dark/system)
- Backend + frontend UserPreferences type update
- Fix hardcoded colors that break in dark mode
- Documentation update

### Out of Scope

- Per-page or per-component theme overrides
- Custom theme colors (user picks their own)
