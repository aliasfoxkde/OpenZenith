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
    // Graduate the satellites layer to error: fully typed against the
    // CesiumType / SatelliteJsApi ambients and the TleRecord fetch boundary
    // (2026-09-28, first file of the no-unsafe-* retirement). New violations
    // here fail lint instead of joining the warning backlog.
    files: ["src/app/globe/lib/layers/satellites.ts"],
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
    // 2026-09-30 graduation cohort of the no-unsafe-* retirement — each file
    // fully typed (file-level no-explicit-any waivers removed) against the
    // CesiumType ambients and typed data-fetchers boundaries:
    //   ContextMenu.tsx — viewer/cesium refs, entity capture, tool-manager
    //     surfaces (also fixed: unguarded requestRender, floating flyTo).
    //   flights.ts — OpenSkyResponse/OpenSkyState boundary, positional state
    //     vectors coerced at one edge (also fixed: dead cam/undefined guards).
    //   volcanoes.ts — VolcanoAlertCollection boundary from the RSS parser.
    //   hurricanes.ts — IBTrACS CSV boundary; columns ≥10 stay runtime-checked.
    //   vessels.ts — VesselsConfig boundary and a runtime-checked AISstream
    //     WebSocket message guard (also fixed: null wsUrl could reach the
    //     WebSocket constructor; window cleanup hook now ambient-typed).
    //   aviation-weather.ts — sigmet/airmet responses normalize via unknown
    //     (upstream shape has varied: array, {features}, {data}).
    //   earthquakes.ts — EarthquakeCollection boundary from the USGS feed.
    // New violations in these files fail lint instead of joining the warning
    // backlog.
    files: [
      "src/app/globe/lib/components/ContextMenu.tsx",
      "src/app/globe/lib/layers/flights.ts",
      "src/app/globe/lib/layers/volcanoes.ts",
      "src/app/globe/lib/layers/hurricanes.ts",
      "src/app/globe/lib/layers/vessels.ts",
      "src/app/globe/lib/layers/aviation-weather.ts",
      "src/app/globe/lib/layers/earthquakes.ts",
      // 2026-10-01: first test-file cohort — terrain-routes.test.ts typed via
      // per-route body readers (slopeBody/aspectBody/profileBody/traceBody/
      // twiBody/watershedBody/streamsBody); the older raw resp.json() suites
      // now go through them too. collections-deep.test.ts and query.test.ts
      // use the shared bodyAs<T>() reader from __tests__/helpers.ts with
      // per-file body interfaces.
      "src/app/api/__tests__/terrain-routes.test.ts",
      "src/app/api/__tests__/collections-deep.test.ts",
      "src/app/api/__tests__/query.test.ts",
      "src/app/api/__tests__/helpers.ts",
    ],
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
    // 2026-10-06: the graduation is complete — every file under app/globe plus
    // the two Cesium E2E specs are typed against the ambient cesium-types.d.ts
    // declarations and the typed data-fetchers boundaries (all 22 layer
    // modules, tools suite, widgets, HudOverlays, page.tsx; 1,909 -> 0
    // warnings). The no-unsafe-* family promotes to error across the whole
    // surface: new untyped data flow in globe code now fails lint instead of
    // rejoining the backlog. The per-file cohorts above remain as history.
    files: [
      "src/app/globe/**/*.{ts,tsx}",
      "e2e/production-verify.spec.ts",
      "e2e/ozt2-validate.spec.ts",
    ],
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
];

export default eslintConfig;
