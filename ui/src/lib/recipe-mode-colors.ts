/**
 * Colours of a recipe mode pill, shared by the zone page header and the
 * Dashboard equipment cards (spec 201) so the two cannot drift.
 *
 * Tokens only, so the pills follow the theme (spec 196). Cocoon and night
 * stay neutral until the series palette gives them a hue of their own.
 */
const MODE_COLORS: Record<string, { bg: string; text: string }> = {
  eco: {
    bg: "color-mix(in srgb, var(--color-success) 10%, transparent)",
    text: "var(--color-success)",
  },
  comfort: { bg: "var(--color-primary-light)", text: "var(--color-primary)" },
  cocoon: { bg: "var(--color-border-light)", text: "var(--color-text-secondary)" },
  night: { bg: "var(--color-border-light)", text: "var(--color-text-secondary)" },
};

const DEFAULT_PILL_COLOR = { bg: "var(--color-border-light)", text: "var(--color-text-secondary)" };

export function modePillColors(value: string): { bg: string; text: string } {
  return MODE_COLORS[value] ?? DEFAULT_PILL_COLOR;
}
