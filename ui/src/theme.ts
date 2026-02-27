/**
 * Theme management — applies "dark" class on <html> based on user preference.
 *
 * Called synchronously in main.tsx (before React) to prevent flash,
 * and from SettingsPage when the user changes their preference.
 */

export type ThemeSetting = "light" | "dark" | "system";

const STORAGE_KEY = "winch_theme";

let mediaQuery: MediaQueryList | null = null;
let mediaListener: (() => void) | null = null;

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function setDarkClass(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
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
