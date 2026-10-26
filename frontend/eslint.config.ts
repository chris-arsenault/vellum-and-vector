import js from "@eslint/js";
import ts from "typescript-eslint";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import refresh from "eslint-plugin-react-refresh";
import perf from "eslint-plugin-react-perf";
import a11y from "eslint-plugin-jsx-a11y";
import sonar from "eslint-plugin-sonarjs";
import prettier from "eslint-config-prettier";
import {
  noDirectFetch,
  noInlineStyles,
  noEscapeHatches,
  noNonVitestTesting,
  noJsFileExtension,
  maxJsxProps,
} from "@ahara/standards/eslint-rules";

const ahara = {
  rules: {
    "no-direct-fetch": noDirectFetch,
    "no-inline-styles": noInlineStyles,
    "no-escape-hatches": noEscapeHatches,
    "no-non-vitest-testing": noNonVitestTesting,
    "no-js-file-extension": noJsFileExtension,
    "max-jsx-props": maxJsxProps,
  },
};

export default ts.config(
  {
    ignores: [
      "dist/**",
      ".artifacts/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": hooks,
      "react-refresh": refresh,
      "react-perf": perf,
      "jsx-a11y": a11y,
      sonarjs: sonar,
      ahara,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...a11y.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "ahara/no-direct-fetch": "error",
      "ahara/no-inline-styles": "error",
      "ahara/no-escape-hatches": "error",
      "ahara/no-non-vitest-testing": "error",
      "ahara/no-js-file-extension": "error",
      "ahara/max-jsx-props": "warn",
      complexity: ["error", 10],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 75, skipBlankLines: true, skipComments: true }],
      "max-depth": ["warn", 4],
    },
  },
  prettier
);
