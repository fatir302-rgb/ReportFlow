import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // This MVP's SQLite boundary intentionally returns untyped rows. Tightening
      // those types is a separate refactor and should not block baseline linting.
      "@typescript-eslint/no-explicit-any": "off",
      // Existing effects initiate remote loads or detect the browser timezone.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "data/**",
  ]),
]);
