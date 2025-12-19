import { defineConfig } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default defineConfig([
  {
    ignores: [".next/**", "out/**", "dist/**", "node_modules/**"],
  },
  ...compat.extends("next/core-web-vitals"),
]);
