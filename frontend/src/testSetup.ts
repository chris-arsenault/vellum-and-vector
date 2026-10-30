import { vi } from "vitest";

// Catch direct, aliased and transitive attempts before an expensive run can begin.
// The opt-in integration configuration deliberately does not load this setup.
vi.mock("../../packages/generation/src/atlasWorkflow", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  generateAtlas() {
    throw new Error(
      "Full generation is forbidden in unit tests. Construct the world state and call the relevant process. Use the shared worldIntegration.generation.test.ts for end-to-end assertions."
    );
  },
}));
vi.mock("../../packages/generation/src/refinement/workflow", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  refineRegionalMap() {
    throw new Error(
      "Full refinement is forbidden in unit tests. Supply present geography and call the relevant refiner. Use worldIntegration.generation.test.ts for complete refinement."
    );
  },
}));
