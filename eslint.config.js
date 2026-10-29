import js from "@eslint/js";
import globals from "globals";
import reactX from "eslint-plugin-react-x";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// React rules come from eslint-plugin-react-x rather than the official
// eslint-plugin-react-hooks, which loads Babel to run the React Compiler.
// See docs/DEPENDENCIES.md.
export default tseslint.config(
  { ignores: ["dist", "worker-configuration.d.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactX.configs["recommended-typescript"]],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      // As strict as eslint-plugin-react-hooks' recommended set, which these replace.
      "react-x/set-state-in-effect": "error",
      "react-x/purity": "error",
      "react-x/refs": "error",
      "react-x/immutability": "error",
      "react-x/globals": "error",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // shadcn/ui components stay as the shadcn CLI writes them, so that
    // `npx shadcn add` and `npx shadcn diff` keep working on them. Rules their
    // upstream code does not follow are off here only. See docs/SHADCN_COMPONENTS.md.
    files: ["src/react-app/components/ui/**"],
    rules: {
      "react-refresh/only-export-components": "off",
      "react-x/no-context-provider": "off",
      "react-x/no-use-context": "off",
      "react-x/use-state": "off",
      "react-x/no-array-index-key": "off",
      "react-x/immutability": "off",
    },
  },
);
