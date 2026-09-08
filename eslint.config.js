import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "ui", "migrations"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "warn",
      // The backend is `"type": "module"` and runs `node dist/index.js`, so Node
      // ESM requires an explicit extension on every relative specifier. But
      // `moduleResolution: "bundler"` in tsconfig.json lets tsc accept one
      // without, and vitest resolves it too — so a missing `.js` compiles, lints
      // and passes the whole suite, then throws ERR_MODULE_NOT_FOUND at startup.
      // The #923 review caught one that way, by hand, on a shared module the UI
      // also imports; nothing in CI would have.
      //
      // Type-only imports are erased and cannot break startup, and they are
      // covered anyway: dropping the `type` keyword from an exempt import would
      // silently arm the failure, which is exactly the edit nobody reviews.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value=/^\\.\\.?\\//]:not([source.value=/\\.(js|json)$/])",
          message:
            'Relative imports need an explicit extension ("./foo.js", not "./foo"): Node ESM refuses it at startup, and tsc under moduleResolution:bundler will not tell you.',
        },
        {
          selector:
            "ExportNamedDeclaration[source.value=/^\\.\\.?\\//]:not([source.value=/\\.(js|json)$/])",
          message: 'Relative re-exports need an explicit extension ("./foo.js", not "./foo").',
        },
        {
          selector:
            "ExportAllDeclaration[source.value=/^\\.\\.?\\//]:not([source.value=/\\.(js|json)$/])",
          message: 'Relative re-exports need an explicit extension ("./foo.js", not "./foo").',
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
