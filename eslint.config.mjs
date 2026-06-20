import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  {
    ignores: [
      ".next/**",
      "out/**",
      "dist/**",
      "node_modules/**",
      "electron/**/*.js",
    ],
  },
  ...nextVitals,
  {
    rules: {
      // Enabled by eslint-config-next 16 / react-hooks v7; existing code
      // uses intentional mount-time hydration patterns.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
]);
