import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// UI test suite (issue #458). Runs from ui/, so react, react-dom, Testing
// Library and the components all resolve from ui/node_modules — one React
// instance, no cross-root aliasing. Pure-logic tests (.test.ts) run in node;
// component tests (.test.tsx) run in jsdom via the React plugin's JSX handling.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    setupFiles: ["./src/test-setup.ts"],
  },
});
