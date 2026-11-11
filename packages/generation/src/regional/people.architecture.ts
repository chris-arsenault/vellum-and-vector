import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture check: a refined map's people run the operations and classifiers the world
 * runs. The regional namespace keeps no village proposals, field declarations, hinterland
 * partition or way tracing of its own; it submits the shared land pass, records places with
 * the shared classifier and publishes through the shared catalogue. Run with
 * `make test-architecture`.
 */
function* sources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$|\.architecture\.ts$/.test(entry.name))
      yield path;
  }
}
const text = (file: string) => readFileSync(join(__dirname, file), "utf8");
/** What only a second people model would need. */
const own: RegExp[] = [
  /\bpropose[A-Z]\w*\(|\bproposed\b/,
  /\bdeclareFields\b|\bhinterlandOwners\b|\btraceWays\b|\bcommutingFlows\b/,
  /\bpopulationDensity\b|\bresidents\b/,
  /\bdenseZones\(|\bcountryOf\(|\brecordPlaces\(/,
  /humanLayerWriter\(/,
];

describe("regions run the world's people", () => {
  it("keeps no people model in the regional namespace", () => {
    const findings: string[] = [];
    for (const path of sources(__dirname)) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (own.some((pattern) => pattern.test(line)))
          findings.push(`${relative(__dirname, path)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(findings).toEqual([]);
  });
  it("has deleted the separate proposal, field and way modules", () => {
    for (const file of ["places.ts", "society.ts", "societyWays.ts", "wayLines.ts"])
      expect(existsSync(join(__dirname, file)), file).toBe(false);
    expect(existsSync(join(__dirname, "..", "siteRanking.ts"))).toBe(false);
  });
  it("lives, records and publishes through the shared operations", () => {
    const people = text("people.ts");
    expect(people).toMatch(/liveKeptPass\(state, context,/);
    expect(people).toMatch(/recordLandPlaces\(state, context,/);
    expect(people).toMatch(/publishPeoplePlaces\(state, context\)/);
    expect(people).toMatch(/restoreTraditions\(state\)/);
  });
});
