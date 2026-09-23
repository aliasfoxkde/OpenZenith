import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

const eslintConfig = [
  js.configs.recommended,
  // Strictest shipped preset (type-aware). Requires projectService below.
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Missing deps is a real correctness bug class, not a style choice.
      "react-hooks/exhaustive-deps": "error",
      // ── Curated tunes (typescript-eslint strictTypeChecked) ──
      // Everything strict ships stays at error EXCEPT the untyped-data-flow
      // symptom class below. Those fire wherever an `any` from JSON parsing,
      // R2 bindings, or external API shapes flows through a member access or
      // template literal — eliminating them requires typing the ~80 route
      // response models (tracked as Phase D data-modeling work in
      // docs/planning/MASTER_PLAN_2026-09-22.md, where they get promoted back
      // to error per-file). Baseline at tune time: member-access 2477,
      // assignment 1499, call 1078, argument 167, return 68, template 612.
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      // Numbers in template literals are type-safe and ubiquitous in a
      // geospatial codebase (tile paths `${z}/${x}/${y}`, coordinate query
      // strings). The strict default flags them; only allow that class —
      // string/number/boolean interpolation stays judged.
      "@typescript-eslint/restrict-template-expressions": ["warn", { allowNumber: true }],
      // React Hooks 7 enables React Compiler migration rules in its recommended
      // preset. These rules currently flag established imperative MapLibre,
      // Cesium, and WASM integrations that are intentionally ref-backed. Keep
      // the conventional Hooks correctness rules enabled, while tracking the
      // compiler migration separately instead of making CI unusable.
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Graduate src/lib/storage to error: the directory is fully typed and
    // warning-free (2026-09-22), and it sits directly on the R2/HF data
    // boundary where untyped flow is most dangerous. New violations here
    // fail lint instead of joining the warning backlog. Same per-directory
    // promotion is the template for retiring the route-layer warnings above.
    files: ["src/lib/storage/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    ignores: [
      ".next/",
      ".vercel/",
      "node_modules/",
      // Local dev/build scratch (next-on-pages bundles); never sources.
      ".wrangler/",
      "eslint.config.mjs",
      "src/lib/wasm/",
      // Build outputs, not sources: WASM bundle and the generated service worker.
      "public/pkg/",
      "public/sw.js",
    ],
  },
  {
    // Build-time Node scripts (plain .mjs, untyped by design). They stay in
    // the project so the parser and core rules apply, but the type-aware
    // data-flow rules have nothing to chew on without declared types.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
];

export default eslintConfig;
