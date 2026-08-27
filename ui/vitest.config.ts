import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// UI test suite (issue #458). Runs from ui/, so react, react-dom, Testing
// Library and the components all resolve from ui/node_modules — one React
// instance, no cross-root aliasing.
//
// The two tiers are split into vitest `projects` because `environmentMatchGlobs`
// was removed in vitest 4. Same contract as before: pure-logic tests (.test.ts)
// run in node, component tests (.test.tsx) run in jsdom. `setupFiles` applies to
// both tiers, as it did when it was declared once at the top level: the
// localStorage stub is needed by logic tests too, and the matchMedia stub
// no-ops under node thanks to its `typeof window` guard.
const shared = {
  globals: true,
  setupFiles: ["./src/test-setup.ts"],
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          ...shared,
          name: "logic",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          ...shared,
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
});
