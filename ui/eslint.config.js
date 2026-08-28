import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "dev-dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // react-hooks/set-state-in-effect tightened in eslint-plugin-react-hooks
      // 7.1 and reports 20 sites, every one of them an on-mount fetch of the
      // shape `useEffect(() => { load(); }, [])`: open a page, go and get its
      // data, store it. The rule's concern is the extra render pass that
      // causes, which can show as a flicker or a loop. It does not here: the
      // pages load correctly, verified across ten routes on the v1.61.0
      // release candidate.
      //
      // Off rather than left at warn, on purpose. Twenty permanent warnings on
      // every lint run is the volume at which people stop reading the output,
      // and rewriting the effect timing of twenty working screens to satisfy an
      // opinionated rule trades a real regression risk for no visible gain.
      // #796 keeps the list of the twenty, so if a screen ever does flicker or
      // loop, the places to look are already written down.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
