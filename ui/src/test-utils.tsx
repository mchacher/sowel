/* eslint-disable react-refresh/only-export-components -- test helper, not a Fast Refresh boundary */
// Shared helpers for the component-test tier (issue #458).
//
// Importing the app i18n instance for its side effect initialises the default
// react-i18next instance synchronously (resources are inlined), so components
// calling `useTranslation()` render real strings without needing a provider.
import "./i18n";

// Re-export Testing Library so component tests import everything from one place.
// `render` auto-cleans up between tests because vitest exposes `afterEach`
// globally (globals: true in vitest.config.ts).
export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

/**
 * Report a primary pointer to `matchMedia("(pointer: coarse)")` — the slide-or-dialog
 * choice of `useGuardedAction` (spec 196). Every other query reads `false`, so
 * `useIsMobile` keeps the desktop default. Returns the restore function.
 */
export function mockPointer(kind: "coarse" | "fine"): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: kind === "coarse" && query.includes("pointer: coarse"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
