import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { testPolicy } from "./testPolicy";

export default ts.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "backend/vendor/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      complexity: ["error", 10],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 75, skipBlankLines: true, skipComments: true }],
      "max-depth": ["warn", 4],
    },
  },
  {
    // What rock means is decided in the catalogue and read through `Ground`; see rock/ground.ts.
    files: ["packages/generation/src/**/*.ts"],
    ignores: ["packages/generation/src/rock/**", "**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^Rock(Resistance|KindCodes)$/]:not(MemberExpression[property.name=/^(set|fill)$/] > MemberExpression)",
          message: "Read rock through groundOf(map); what it means belongs in the rock catalogue.",
        },
      ],
    },
  },
  ...testPolicy,
  prettier
);
