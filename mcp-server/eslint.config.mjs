// Mirrors api/eslint.config.mjs's typed-lint essentials, trimmed to what a
// non-React Node package needs: no react-hooks/@next plugins, no per-directory
// no-unsafe-* graduations. This package is small enough that the whole
// strictTypeChecked preset runs at error with zero findings — there is no
// warning backlog to graduate, so none is created.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

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
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Same tune as api/eslint.config.mjs, promoted to error: numbers in
      // template literals are type-safe and ubiquitous in a geospatial package
      // (coordinate query strings `?lat=${lat}&lon=${lon}`). Only that class is
      // allowed — string/boolean interpolation stays judged.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    ignores: [
      "node_modules/",
      // Build outputs, not sources: tsc emit and stale next/trace scratch.
      "dist/",
      ".next/",
    ],
  },
];

export default eslintConfig;
