import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The browser extension is its own WXT project (extension/, own tsconfig + lint).
    "extension/**",
    // Vendored browser bundles copied by the postinstall scripts.
    "public/pdfjs/**",
    "public/typst/wasm/**",
  ]),
]);

export default eslintConfig;
