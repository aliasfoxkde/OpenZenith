import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import jsdoc from "eslint-plugin-jsdoc";
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
      jsdoc,
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
      // The untyped-data-flow symptom class (no-unsafe-*) started at warn in
      // Oct-2025 with a 5,900+ violation backlog (member-access 2477,
      // assignment 1499, call 1078, argument 167, return 68, template 612)
      // and was retired cohort-by-cohort through per-file graduation blocks —
      // routes/lib typed against real response models through 2026-10-06
      // (globe surface) and 2026-10-07 (everything else).
      // With the census at ZERO violations repo-wide, the ladder is finished:
      // the family is error globally and the graduation blocks are gone. Any
      // new `any` leaking into a member access now fails lint.
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      // Numbers in template literals are type-safe and ubiquitous in a
      // geospatial codebase (tile paths `${z}/${x}/${y}`, coordinate query
      // strings). The strict default flags them; only allow that class —
      // string/number/boolean interpolation stays judged.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // no-non-null-assertion (inherited error from strictTypeChecked) is
      // retired alongside the noUncheckedIndexedAccess adoption (excellence
      // cycle V, 2026-10-09). Under that flag the bounded non-null assertion
      // is THE sanctioned idiom for provably-in-range index reads — tsc
      // itself demands it ~1,000× across the tree. Compensating discipline:
      // every assertion carries a `// bounds: <why>` comment (grammar in
      // EXCELLENCE_PLAN_V), forbidden escapes (@ts-ignore, `as any`,
      // signature loosening) stay error'd, and the rule this replaces never
      // permitted comment-scoped opt-outs, so "off" is the only coherent
      // setting once the flag is on.
      "@typescript-eslint/no-non-null-assertion": "off",
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
      // ── Export documentation gate (D2 of cycle IV) ──
      // ERROR (CI is a hard --max-warnings=0 gate, so warn-level would be a
      // red pipeline). publicOnly scopes the gate to the API callers actually
      // see; contexts limit it to exports (module-surface docs), not every
      // internal function signature.
      //
      // GRADUATED 2026-10-21. The measured 705-warning backlog (186 files)
      // was retired file-by-file — document a file's exports, delete its line
      // from the graduation block, repeat — and the block is now deleted.
      // The census over all 186 grandfathersed files, run with this block
      // absent, reports ZERO violations, so the gate is closed for the whole
      // tree: every exported symbol in src/ carries a description. New files
      // were gated from their first commit throughout (the block listed files
      // individually, never as directory globs).
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          contexts: [
            "TSInterfaceDeclaration",
            "TSTypeAliasDeclaration",
            "ExportDefaultDeclaration",
            "ExportNamedDeclaration > VariableDeclaration",
            "ExportNamedDeclaration > FunctionDeclaration",
            "ExportNamedDeclaration > TSInterfaceDeclaration",
            "ExportNamedDeclaration > TSTypeAliasDeclaration",
          ],
        },
      ],
      "jsdoc/require-description": "error",
    },
  },
  // The no-unsafe-* graduation ladder (2026-09-22 → 2026-10-07) ran through
  // per-file/per-directory blocks — src/lib/storage, the satellites layer,
  // the 2026-09-30 globe cohort, the 2026-10-01 test-file cohort, and the
  // 2026-10-06 full-globe completion. With the census at zero violations
  // repo-wide, the family is error in the global block above and all
  // graduation blocks are removed; the git history of this file is the
  // cohort record.
  {
    ignores: [
      ".next/",
      ".vercel/",
      "node_modules/",
      // npm renames the previous tree to node_modules.<random> when an
      // install is interrupted. ESLint's flat config auto-discovers any
      // eslint.config.* it finds while walking the tree, so a leftover
      // package's own config would be loaded as THIS project's config and
      // the whole lint gate would die on ERR_MODULE_NOT_FOUND (2026-10-21:
      // node_modules.stale/cesium/eslint.config.js). Ignore the whole
      // family, not just the exact name.
      "node_modules.*",
      // Local dev/build scratch (next-on-pages bundles); never sources.
      ".wrangler/",
      "eslint.config.mjs",
      "src/lib/wasm/",
      // Build outputs, not sources: WASM bundle, the generated service worker,
      // and the vendored Cesium/satellite.js distributions copied from
      // node_modules by scripts/copy-vendor-assets.mjs (self-hosted 2026-10,
      // unmodified upstream files — minified chunks the project service
      // can't type).
      "public/pkg/",
      "public/sw.js",
      "public/cesium/",
      "public/vendor/",
      // Local coverage report (vitest --coverage writes minified instrumented
      // sources here; parsing them is noise).
      "coverage/",
      // Next-generated ambient declarations (regenerated by every build; the
      // routes.d.ts triple-slash reference it gains post-build is Next's own).
      "next-env.d.ts",
    ],
  },
  {
    // Build-time Node scripts (plain .mjs, untyped by design). They stay in
    // the project so the parser and core rules apply, but the type-aware
    // data-flow rules have nothing to chew on without declared types.
    // measure-perf.mjs additionally drives a real browser via CDP, so it
    // needs the browser globals alongside Node's.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
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
  {
    // Test files use untyped fixtures and mocks (Buffer.from, deflateSync, etc.)
    // by design. The no-unsafe-* family flags these inevitably in test code that
    // exercises the SDK layer with real binary data. Disable globally for tests.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
];

export default eslintConfig;
