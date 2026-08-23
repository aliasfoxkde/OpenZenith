import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

const eslintConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Disable strict render rules for page components (refactoring needed separately)
      "react-hooks/exhaustive-deps": "off",
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
    ignores: [".next/", ".vercel/", "node_modules/", "eslint.config.mjs", "src/lib/wasm/"],
  },
];

export default eslintConfig;
