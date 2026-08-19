// Component-test tier setup (issue #458), loaded via vitest `setupFiles`.
//
// Some stores (e.g. useAuth) read `localStorage` at module-init time. jsdom's
// built-in localStorage is not reliably available under vitest, so any test
// that imports such a store at the top level would throw before a `beforeEach`
// could stub it. Install a minimal in-memory Storage here, before any test
// module loads. Tests that need to assert on persistence (useAuth.test.ts)
// still replace `globalThis.localStorage` with their own instance.
function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, String(v));
    },
  };
}

const existing = globalThis.localStorage as Storage | undefined;
if (!existing || typeof existing.getItem !== "function") {
  globalThis.localStorage = makeStorage();
}

// jsdom does not implement `matchMedia`; `useIsMobile` (useSyncExternalStore over
// matchMedia) throws without it. Install a minimal desktop-default stub so any
// component reading a media query renders under test. A test that needs the
// mobile branch overrides `window.matchMedia` to report `matches: true`.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
