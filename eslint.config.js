import tseslint from "typescript-eslint";
import unslop from "eslint-plugin-unslop";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "skills/**", ".superpowers/**", "scripts/**"],
  },
  ...tseslint.configs.recommended,
  unslop.configs.full,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "varsIgnorePattern": "^_" }],
    },
  },
  {
    settings: {
      unslop: {
        architecture: {},
      },
    },

  },
);
