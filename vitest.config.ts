import { defineConfig } from "vitest/config";

// Backend test suite. UI tests moved to ui/vitest.config.ts (issue #458), which
// runs from ui/ so React resolves to a single copy for the component-test tier.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
    },
  },
});
