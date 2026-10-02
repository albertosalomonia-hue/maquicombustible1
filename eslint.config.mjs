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
    // Librería de terceros (js-fluid-meter) servida tal cual.
    "public/vendor/**",
  ]),
  {
    rules: {
      // Las respuestas de la API Express no están tipadas; el código usa `any` a propósito.
      "@typescript-eslint/no-explicit-any": "off",
      // Textos en español con comillas dentro de JSX.
      "react/no-unescaped-entities": "off",
      // Prellenar formularios / leer localStorage tras hidratar requiere setState en efectos.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
