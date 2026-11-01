import { afterAll, describe, expect, it } from "vitest";
import {
  constructedCase,
  evaluateCase,
  generatedCase,
  generatedWorld,
  writeEvaluationReport,
  type CaseRecord,
} from "./testSupport/regionalEvaluation";

/**
 * The frozen regional evaluation: renders and timings for the four paired cases under
 * `.artifacts/regional/evaluation/<variant>/`. Run explicitly with
 * `ATLAS_REGIONAL_VARIANT=baseline|candidate pnpm --dir frontend exec vitest run -c vitest.regional.config.ts`.
 */
const records: CaseRecord[] = [];
let worldMs: number | null = null;

describe("frozen regional evaluation", () => {
  afterAll(() => writeEvaluationReport(records, worldMs));
  it("P1 mountain country", async () => {
    const f = await constructedCase("P1");
    const record = await evaluateCase(f, "P1");
    records.push(record);
    expect(record.deterministic).toBe(true);
  }, 900_000);
  it("P2 plateau and coastal basin", async () => {
    const f = await constructedCase("P2");
    const record = await evaluateCase(f, "P2");
    records.push(record);
    expect(record.deterministic).toBe(true);
  }, 900_000);
  it("M1 and M2 from one generated world", async () => {
    const world = await generatedWorld();
    worldMs = world.worldMs;
    try {
      for (const id of ["M1", "M2"] as const) {
        const { fixture, present, systems } = await generatedCase(world, id),
          missing = systems.filter((system) => !present.includes(system)),
          record = await evaluateCase(
            fixture,
            id,
            missing.length ? `parent selection lacks ${missing.join(", ")}` : undefined
          );
        records.push(record);
        expect(record.deterministic).toBe(true);
      }
    } finally {
      world.close();
    }
  }, 1_800_000);
});
