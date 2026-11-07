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
    // Facts are the catalogue's, reads go through `Ground`, writes through the rock module and its
    // ledger. See MATERIALS-AND-PROCESSES-ARCHITECTURE.md.
    files: ["packages/generation/src/**/*.ts"],
    ignores: ["packages/generation/src/rock/**", "**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^Rock(Resistance|KindCodes|Layer(Kind|Depth)\\d)$/]",
          message:
            "Rock bands belong to the rock module: read through groundOf(map), write through rock/.",
        },
        {
          selector: "ImportSpecifier[imported.name=/^(baselineRock|rockKindOfCode|hardnessOf)$/]",
          message: "Ask the ground, with a query beside the code that needs it.",
        },
        {
          selector: "ImportSpecifier[imported.name=/^(modes|givenUp)$/]",
          message: "A process says how it acts with compileMix; how facts answer belongs to modes.",
        },
        {
          selector: "Property[key.name=/^Maximum\\w*Per(Pass|Iteration|Span)$/]",
          message:
            "Caps exist only for numerical reasons. Limit a process by supply, capacity or stepping.",
        },
      ],
    },
  },
  ...testPolicy,
  prettier
);
