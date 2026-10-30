import type { Linter } from "eslint";

const generation = {
  group: ["@atlas/generation", "**/atlasWorkflow", "**/refinement/workflow"],
  importNames: ["generateAtlas", "refineRegionalMap"],
  message:
    "Construct the state and call the relevant process. Full generation belongs only in worldIntegration.generation.test.ts.",
};
const schedules = {
  group: ["**/schedule", "**/canonry/sequence", "./sequence"],
  importNames: [
    "physicalSchedule",
    "initialSteps",
    "geologySteps",
    "climateSteps",
    "glaciationSteps",
    "extractionSteps",
  ],
  message:
    "Do not run a world schedule as unit-test setup. Supply a constructed field and invoke only the processes under test.",
};

/** Standard ESLint import rules make the expensive-test boundary part of normal CI. */
export const testPolicy: Linter.Config[] = [
  {
    files: ["**/*.test.ts", "**/*Fixture.ts"],
    ignores: ["**/worldIntegration.generation.test.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [generation] }] },
  },
  {
    files: ["**/*.test.ts"],
    ignores: ["**/worldIntegration.generation.test.ts", "**/featureComposition.test.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [generation, schedules] }] },
  },
  {
    files: ["tests/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'CallExpression[callee.name="test"]:not([arguments.0.value=/@deferred-authoring/]) Property[key.name="fields"]',
          message:
            "Use numerical for data preconditions; raster rendering is a separate @rendering scenario boundary.",
        },
        {
          selector:
            'CallExpression[callee.name="test"]:not([arguments.0.value=/@deferred-authoring/]) CallExpression[callee.name="generatedWorld"]',
          message:
            "Reuse a completed map with openFixtureMap. generatedWorld is retained only for deferred authoring scenarios.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test"],
              message:
                "Import test from ./uiTest so UI tests always use small fixtures and cannot start real generation.",
            },
          ],
          patterns: [generation, schedules],
        },
      ],
    },
  },
];
