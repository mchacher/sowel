import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import designClasses from "./eslint/design-classes.js";
import chartColors from "./eslint/chart-colors.js";

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
  {
    // Spec 196, FR-3 — every displayed number goes through `src/lib/format.ts`,
    // which writes French as French (decimal comma, U+202F before the unit,
    // U+2212 minus) and keeps one precision per unit. `toFixed` ignores the
    // language, so « 14.16 kWh » sat beside « 0,7 % » on the same page.
    //
    // An error since slice 3b, when the last component migrated. A non-display
    // use (an SVG coordinate) rounds with Math.round instead, so the rule needs
    // no exceptions. Dates follow the same rule: `toLocale*String()` with no
    // locale, `undefined` or `[]` follows the browser's language, not Sowel's —
    // pass `currentLocale()` from lib/format.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/format.ts", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: "toFixed ignores the language: use lib/format (formatNumber, formatWithUnit…).",
        },
        {
          selector: "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']",
          message: "Number formatting goes through lib/format.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleString'][arguments.length=0]",
          message: "toLocaleString() without a locale follows the browser, not Sowel's language.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/][arguments.length=0]",
          message:
            "toLocaleDateString() without a locale follows the browser: pass currentLocale() from lib/format.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/] > :matches(Identifier[name='undefined'], ArrayExpression[elements.length=0]).arguments:first-child",
          message:
            "A locale of undefined or [] follows the browser, not Sowel's language: pass currentLocale() from lib/format.",
        },
        {
          selector:
            ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][callee.property.name='DateTimeFormat'] > :matches(Identifier[name='undefined'], ArrayExpression[elements.length=0]).arguments:first-child",
          message:
            "Intl.DateTimeFormat(undefined | []) follows the browser, not Sowel's language: pass currentLocale() from lib/format.",
        },
        {
          selector:
            "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat'][arguments.length=0]",
          message:
            "new Intl.DateTimeFormat() follows the browser, not Sowel's language: pass currentLocale() from lib/format.",
        },
      ],
    },
  },
  {
    // Spec 196, FR-5 and decision pr7-rayons — the type scale, sentence case
    // and the radius scale, judged on class tokens (variants and `!` included)
    // by eslint/design-classes.js. Separate rules, so an exception disables
    // one of them and leaves the formatting rules above on.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { sowel: designClasses },
    rules: {
      "sowel/type-scale": "error",
      "sowel/sentence-case": "error",
      "sowel/radius-scale": "error",
    },
  },
  {
    // Spec 196 (FR-E) — energy and history charts paint from theme tokens, so
    // a legend cannot keep its light-theme colour in dark. eslint/chart-colors.js.
    // Also the energy surfaces that live elsewhere: the tariff strip, the UPS
    // panel and the EV sessions.
    files: [
      "src/components/energy/**/*.{ts,tsx}",
      "src/components/history/**/*.{ts,tsx}",
      "src/components/settings/TariffSettings.tsx",
      "src/components/equipments/UpsPanel.tsx",
      "src/components/equipments/ev-sessions/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { "sowel-chart": chartColors },
    rules: {
      "sowel-chart/no-hex-color": "error",
    },
  },
  {
    // #1187 — keep the first load small. Two imports undid the code splitting
    // on their own: a namespace import of lucide-react (or its `icons` map)
    // ships all ~1,600 icons, and a static import of hls.js puts the 560 KB
    // camera player on every page. Plugin icons go through lib/plugin-icons;
    // hls.js is loaded with import("hls.js") when a live view starts.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              importNames: ["icons"],
              message:
                "This pulls every Lucide icon into the bundle (#1187): import icons by name, or resolve a manifest name with lib/plugin-icons.",
            },
            {
              name: "lucide-react/dynamic",
              message:
                "Dynamic Lucide icons are not used (#1187): resolve a manifest name with lib/plugin-icons.",
            },
            {
              name: "hls.js",
              allowTypeImports: true,
              message:
                'hls.js is 560 KB and only the camera live view needs it (#1187): load it with import("hls.js").',
            },
          ],
        },
      ],
    },
  },
]);
