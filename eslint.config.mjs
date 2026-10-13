import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  // 생성물은 린트하지 않는다. `.next/**` 는 Vite 프로젝트인데도 생긴다 —
  // tsconfig 의 incremental 산출물이 `.next/cache/.tsbuildinfo` 로 떨어지고,
  // CI runner 에서는 번들 chunk 까지 생겨 CommonJS 규칙 위반으로 lint 가 깨졌다.
  // 소스를 한 줄도 건드리지 않은 PR 이 lint 에서 실패하는 원인이었다.
  globalIgnores([
    "dist/**",
    "build/**",
    ".next/**",
    "coverage/**",
    "node_modules/**",
    "docs/**",
    "site/**",
    // Deliberate violations for __tests__/lintHooksGate.test.ts, which lints them itself.
    "__tests__/lint-fixtures/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // React Hooks correctness (#982). Debt that existed when the rules were turned on
  // is frozen in eslint-suppressions.json: a new violation fails, and a fixed one
  // fails until `npm run lint:prune` lowers the baseline.
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // Recommended ships this one as a warning; an error is what the baseline can hold.
      "react-hooks/incompatible-library": "error",
      // A promise nobody awaits or catches loses its rejection (#982).
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
]);

export default eslintConfig;
