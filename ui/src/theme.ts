/**
 * Theme management — applies "dark" class on <html> based on user preference.
 *
 * Called synchronously in main.tsx (before React) to prevent flash,
 * and from SettingsPage when the user changes their preference.
 */

export type ThemeSetting = "light" | "dark" | "system";

const STORAGE_KEY = "sowel_theme";

let mediaQuery: MediaQueryList | null = null;
let mediaListener: (() => void) | null = null;

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Browser bar colour per theme (spec 196, 4b): the ocean ink in light, the
 * night page in dark — design-system/tokens.css --p-500 light and --n-50 dark,
 * checked by lib/color-roles.test.ts. index.html ships one meta per OS scheme;
 * once the app knows its own theme, both carry that theme's colour, so a user
 * who picked dark on a light OS gets a dark bar.
 */
export const THEME_COLOR = { light: "#1A4F6E", dark: "#0E191F" } as const;

function setDarkClass(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = dark ? THEME_COLOR.dark : THEME_COLOR.light;
  }
}

/**
 * Apply theme to the document. Call with the stored setting
 * (from localStorage or user preferences). Defaults to "system".
 */
export function applyTheme(setting: ThemeSetting | null): void {
  const theme: ThemeSetting = setting ?? "system";

  // Clean up previous system listener
  if (mediaListener && mediaQuery) {
    mediaQuery.removeEventListener("change", mediaListener);
    mediaListener = null;
  }

  if (theme === "dark") {
    setDarkClass(true);
  } else if (theme === "light") {
    setDarkClass(false);
  } else {
    // "system" — follow OS preference and listen for changes
    setDarkClass(prefersDark());
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaListener = () => setDarkClass(prefersDark());
    mediaQuery.addEventListener("change", mediaListener);
  }
}

/**
 * Save theme preference to localStorage and apply it.
 */
export function setTheme(setting: ThemeSetting): void {
  localStorage.setItem(STORAGE_KEY, setting);
  applyTheme(setting);
}
