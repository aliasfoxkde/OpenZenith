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
      "@typescript-eslint/no-explicit-any": "error",      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Missing deps is a real correctness bug class, not a style choice.
      "react-hooks/exhaustive-deps": "error",
      // ── Curated tunes (typescript-eslint strictTypeChecked) ──
      // The untyped-data-flow symptom class (no-unsafe-*) started at warn in
      // Oct-2025 with a 5,900+ violation backlog (member-access 2477,
      // assignment 1499, call 1078, argument 167, return 68, template 612)
      // and was retired cohort-by-cohort through the per-file graduation
      // blocks below it — routes/lib typed against real response models
      // through 2026-10-06 (globe surface) and 2026-10-07 (everything else).
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
      // internal function signature. The measured 705-warning backlog sits
      // grandfathered in the graduation block at the bottom of this file.
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
    // jsdoc graduation block (D2, excellence cycle IV, 2026-10-08). The
    // export-documentation gate (jsdoc/require-jsdoc publicOnly + exports
    // contexts, jsdoc/require-description) is ERROR globally; this block
    // grandfathers the measured backlog: 705 warnings across exactly these
    // 186 files at adoption time. Dynamic-segment routes escape
    // their [brackets] because minimatch would read [z] as a one-char class.
    // Ratchet protocol mirrors the no-unsafe-* ladder: document a file's
    // exports, delete its line; the gate is fully closed when the block is
    // empty and gets deleted. Files are listed individually (not as directory
    // globs) so NEW files are gated from their first commit.
    files: [
      "src/app/about/layout.tsx",
      "src/app/about/page.tsx",
      "src/app/api/__tests__/helpers.ts",
      "src/app/api/airquality/route.ts",
      "src/app/api/aod/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/arcgis/route.ts",
      "src/app/api/aspect/route.ts",
      "src/app/api/bathymetry/route.ts",
      "src/app/api/bgp/route.ts",
      "src/app/api/biomass/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/canopy-height/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/chlorophyll/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/collections/\\[id\\]/items/route.ts",
      "src/app/api/collections/\\[id\\]/route.ts",
      "src/app/api/collections/route.ts",
      "src/app/api/contours/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/coverage/route.ts",
      "src/app/api/dem-tile/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/dem-tile/route.ts",
      "src/app/api/disturbance-alerts/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/docs-md/route.ts",
      "src/app/api/docs/page.tsx",
      "src/app/api/drought-hazard/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/dynamic-surface-water/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/earthquakes/route.ts",
      "src/app/api/elevation-accuracy/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/elevation-color/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/elevation/batch/route.ts",
      "src/app/api/elevation/route.ts",
      "src/app/api/fire-temperature/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/flights/route.ts",
      "src/app/api/flood-hazard/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/floods-tile/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/gebco-tile/\\[name\\]/route.ts",
      "src/app/api/geocode/route.ts",
      "src/app/api/geoip/route.ts",
      "src/app/api/gps-jamming/route.ts",
      "src/app/api/health/route.ts",
      "src/app/api/hurricanes/route.ts",
      "src/app/api/landcover/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/landslide-hazard/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/military/route.ts",
      "src/app/api/ndvi/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/nlnog/route.ts",
      "src/app/api/no2-pollution/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/openapi.json/route.ts",
      "src/app/api/opensky/flights/route.ts",
      "src/app/api/opensky/token/route.ts",
      "src/app/api/overpass/route.ts",
      "src/app/api/pm25/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/pmtiles/\\[key\\]/route.ts",
      "src/app/api/population/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/precipitation/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/profile/route.ts",
      "src/app/api/proxy/\\[...path\\]/route.ts",
      "src/app/api/proxy/tile/route.ts",
      "src/app/api/proxy/wms/route.ts",
      "src/app/api/query/route.ts",
      "src/app/api/reverse-geocode/route.ts",
      "src/app/api/sar-backscatter/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/satellites/route.ts",
      "src/app/api/sea-height/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/sea-salinity/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/sentinel2/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/slope/route.ts",
      "src/app/api/snow-cover/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/so2-volcanic/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/soil-moisture/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/space-weather/route.ts",
      "src/app/api/sst/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/stac/\\[...path\\]/route.ts",
      "src/app/api/stac/collections/\\[id\\]/items/route.ts",
      "src/app/api/streams/route.ts",
      "src/app/api/tile/\\[z\\]/\\[x\\]/\\[y\\]/route.ts",
      "src/app/api/tiles/\\[tileMatrixSetId\\]/\\[tileMatrix\\]/\\[tileRow\\]/\\[tileCol\\]/route.ts",
      "src/app/api/tiles/\\[tileMatrixSetId\\]/route.ts",
      "src/app/api/tiles/route.ts",
      "src/app/api/trace/route.ts",
      "src/app/api/twi/route.ts",
      "src/app/api/vessels/route.ts",
      "src/app/api/volcanoes/route.ts",
      "src/app/api/watershed/route.ts",
      "src/app/api/waterways/route.ts",
      "src/app/api/weather/warnings/route.ts",
      "src/app/api/wildfires/route.ts",
      "src/app/contribute/layout.tsx",
      "src/app/contribute/page.tsx",
      "src/app/demo/layout.tsx",
      "src/app/demo/page.tsx",
      "src/app/explore/data.ts",
      "src/app/explore/layout.tsx",
      "src/app/explore/loading.tsx",
      "src/app/explore/page.tsx",
      "src/app/explore/tabs/EarthquakesTab.tsx",
      "src/app/explore/tabs/FlightsTab.tsx",
      "src/app/explore/tabs/MarineTab.tsx",
      "src/app/explore/tabs/NoaaTab.tsx",
      "src/app/explore/tabs/OverpassTab.tsx",
      "src/app/explore/tabs/OvertureTab.tsx",
      "src/app/explore/tabs/SatellitesTab.tsx",
      "src/app/globe/layout.tsx",
      "src/app/globe/lib/components/ContextMenu.tsx",
      "src/app/globe/lib/components/HudOverlays.tsx",
      "src/app/globe/lib/components/chrome.tsx",
      "src/app/globe/lib/components/panels.tsx",
      "src/app/globe/lib/helpers.ts",
      "src/app/globe/lib/iss.ts",
      "src/app/globe/lib/lod.ts",
      "src/app/globe/lib/orbit.ts",
      "src/app/globe/lib/tools/annotations.ts",
      "src/app/globe/lib/tools/bookmarks.ts",
      "src/app/globe/lib/tools/range-rings.ts",
      "src/app/globe/lib/tooltip.ts",
      "src/app/globe/lib/widgets/BasemapWidget.tsx",
      "src/app/globe/lib/widgets/LayersWidget.tsx",
      "src/app/globe/lib/widgets/SettingsWidget.tsx",
      "src/app/globe/lib/widgets/ToolsWidget.tsx",
      "src/app/globe/lib/widgets/WidgetBar.tsx",
      "src/app/globe/lib/widgets/WidgetShell.tsx",
      "src/app/globe/loading.tsx",
      "src/app/globe/page.tsx",
      "src/app/landing/HeroMap.tsx",
      "src/app/landing/SnippetTabs.tsx",
      "src/app/landing/map-helpers.ts",
      "src/app/landing/maplibre-loader.ts",
      "src/app/layout.tsx",
      "src/app/map/controls.tsx",
      "src/app/map/layout.tsx",
      "src/app/map/lib/layers/annotations.ts",
      "src/app/map/lib/layers/types.ts",
      "src/app/map/loading.tsx",
      "src/app/map/page.tsx",
      "src/app/map/panels.tsx",
      "src/app/map/toolbars.tsx",
      "src/app/not-found.tsx",
      "src/app/page.tsx",
      "src/app/robots.ts",
      "src/app/sitemap.ts",
      "src/app/studio/components/DataTable.tsx",
      "src/app/studio/components/DataTool.tsx",
      "src/app/studio/components/DrawingTool.tsx",
      "src/app/studio/components/ElevationProfile.tsx",
      "src/app/studio/components/ElevationTool.tsx",
      "src/app/studio/components/FlowPathTool.tsx",
      "src/app/studio/components/GeocodeTool.tsx",
      "src/app/studio/components/LayersTool.tsx",
      "src/app/studio/components/OnboardingOverlay.tsx",
      "src/app/studio/components/OverpassTool.tsx",
      "src/app/studio/components/TileDownloadTool.tsx",
      "src/app/studio/components/ToolPanel.tsx",
      "src/app/studio/components/WeatherTool.tsx",
      "src/app/studio/layout.tsx",
      "src/app/studio/lib/map-state.ts",
      "src/app/studio/loading.tsx",
      "src/app/studio/page.tsx",
      "src/app/wasm-demo/page.tsx",
      "src/components/CodeBlock.tsx",
      "src/components/Footer.tsx",
      "src/components/GetInTouch.tsx",
      "src/components/Logo.tsx",
      "src/components/MapLoading.tsx",
      "src/components/Navbar.tsx",
      "src/components/ServiceWorkerRegistration.tsx",
      "src/components/SurveillanceUI.tsx",
      "src/components/Toolbar.tsx",
      "src/lib/__tests__/tile-fixtures.ts",
      "src/lib/basemaps.ts",
      "src/lib/brotli_wasm.ts",
      "src/lib/client-elevation.ts",
      "src/lib/elevation-params.ts",
      "src/lib/flow-path.ts",
      "src/lib/gibs-tile.ts",
      "src/lib/layers/types.ts",
      "src/lib/ozt2_decode.ts",
      "src/lib/point-elevation.ts",
      "src/lib/srtm/merged-parser.ts",
      "src/lib/storage/huggingface-backend.ts",
      "src/lib/storage/ozt2-backend.ts",
      "src/lib/terrain-grid.ts",
      "src/lib/theme.ts",
      "src/lib/tides/noaa.ts",
      "src/lib/tile-params.ts",
      "src/lib/tile.ts",
      "src/lib/weather/open-meteo.ts",
      "src/middleware.ts",
      "src/types/openzenith-core.d.ts",
    ],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
    },
  },
];

export default eslintConfig;
