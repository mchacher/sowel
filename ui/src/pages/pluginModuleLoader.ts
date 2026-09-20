/**
 * Spec 180 — the one place the SPA imports code it did not build.
 *
 * A seam rather than an inline `import()`: the URL is a runtime value, so the
 * call cannot be mocked where it stands, and the page's own behaviour (what it
 * shows while loading, what it shows when the module is broken) deserves tests
 * that do not need a real plugin on disk.
 */
export async function loadPluginModule(entryUrl: string): Promise<unknown> {
  return import(/* @vite-ignore */ entryUrl);
}
