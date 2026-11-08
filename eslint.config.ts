import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { testPolicy } from "./testPolicy";

const ownerImports = [
  {
    group: ["**/groundStorage", "**/groundStorage.ts"],
    allowTypeImports: true,
    message: "Writable ground storage belongs to rock/. Use a complete Ground operation.",
  },
  {
    group: ["**/groundTestFixture", "**/groundTestFixture.ts"],
    message: "Mutable ground fixtures are supplied test inputs; production fields use createField.",
  },
  {
    group: ["**/rockColumn", "**/rockColumn.ts"],
    importNames: [
      "setLayer",
      "copyLayer",
      "stripRock",
      "layDownRock",
      "layDownPackage",
      "coarsenColumn",
      "layBed",
      "layBedOfCode",
      "overthrust",
      "expose",
    ],
    message:
      "Column edits are internal to rock/. Use the complete placement, wear or alteration operation.",
  },
  {
    group: ["**/groundShares", "**/groundShares.ts"],
    importNames: ["projectGround", "openCut", "moveFacet", "resetShares"],
    message:
      "Facet mutation and projection belong inside the ground operation; callers must not repair it.",
  },
  {
    group: ["**/groundMaterial", "**/groundMaterial.ts"],
    importNames: ["placeMaterial", "withdrawColumn", "withdrawBuried"],
    message: "Material stack mutation belongs inside a complete ground operation.",
  },
  {
    group: ["**/groundIncision", "**/groundIncision.ts"],
    importNames: ["widenIncision"],
    message: "Facet widening is internal to the incision operation.",
  },
];
const resourceImports = {
  group: ["**/groundResources", "**/groundResources.ts"],
  importNames: ["importGroundBand", "finishGroundImport"],
  message: "Raw ground imports belong to workspace resource restoration, not geological processes.",
};

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
  {
    files: ["**/*.ts"],
    ignores: [
      "packages/generation/src/rock/**",
      "packages/generation/src/world/field.ts",
      "packages/generation/src/world/atlasWorkspace.ts",
      "frontend/src/harness/fieldSnapshot.ts",
      // Explicit captured-input column experiments, not a geological process or world generator.
      "frontend/src/harness/groundCaptured.harness.ts",
      "**/*.test.ts",
      "**/worldGeographyFixtures.ts",
      "**/design.architecture.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [...ownerImports, resourceImports],
        },
      ],
    },
  },
  {
    files: [
      "packages/generation/src/world/atlasWorkspace.ts",
      "frontend/src/harness/fieldSnapshot.ts",
    ],
    rules: { "no-restricted-imports": ["error", { patterns: ownerImports }] },
  },
  {
    files: ["packages/generation/src/rock/**/*.ts"],
    ignores: ["**/*.test.ts", "**/groundTestFixture.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "./groundStorage",
              importNames: ["groundFixture", "ownGround"],
              message: "Fixture and field construction capabilities are not ground operations.",
            },
          ],
          patterns: [
            {
              group: ["**/groundTestFixture", "**/groundTestFixture.ts"],
              message: "Mutable ground fixtures are only supplied test inputs.",
            },
          ],
        },
      ],
    },
  },
  ...testPolicy,
  prettier
);
