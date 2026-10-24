/**
 * Demographic and route inventory of one generated world, for judging the classic-age
 * plan's targets. Runs the default draft recipe headlessly and prints the measures.
 *
 *   pnpm --dir frontend inventory:society
 *   SEED=7 WIDTH=4000000 HEIGHT=3000000 QUALITY=standard pnpm --dir frontend inventory:society
 *   ERAS='[{"id":"Settlement","years":300,"physicalEpoch":null,"mobility":1,"politicalCapacity":1}]' \
 *     pnpm --dir frontend inventory:society   # replaces the present eras, keeps bound rounds
 *   STEP=10 pnpm --dir frontend inventory:society   # fixed cycle length, for comparison
 */
import { generateAtlas, societyInventory, roundCycle, settledCycle } from "@atlas/generation";
import { newGenerationDraft, prepareDraft } from "../src/generationDraft";
import { generationSnapshot } from "../src/generationJobs";

const draft = newGenerationDraft();
draft.width = Number(process.env.WIDTH ?? 3_000_000);
draft.height = Number(process.env.HEIGHT ?? 2_000_000);
if (process.env.SEED) draft.recipe.seed = Number(process.env.SEED);
draft.recipe.quality = process.env.QUALITY === "standard" ? "standard" : "draft";
if (process.env.ERAS) {
  // Eras are the cultural feature's configuration; recipe settings are derived from it.
  const cultural = draft.recipe.features!["human.cultures"];
  const eras = (cultural.configuration?.eras ?? []) as { physicalEpoch?: string | null }[];
  cultural.configuration = {
    eras: [...eras.filter((era) => era.physicalEpoch), ...JSON.parse(process.env.ERAS)],
  };
}
if (process.env.STEP) {
  const step = Number(process.env.STEP);
  settledCycle.min = settledCycle.max = step;
  roundCycle.min = roundCycle.max = Math.max(step, 25);
}
draft.recipe.domains = ["physical", "magic", "cultural", "political", "built"];
const { source, input, diagnostics } = prepareDraft(draft);
const errors = diagnostics.filter((d) => d.severity === "error");
if (errors.length) throw new Error(errors.map((d) => d.message).join("\n"));

// Timing from progress messages: each process reports Starting/Completed; society cycles
// report "<era>: year X of Y" (rounds) or "Societies: year X of Y" (present eras).
const seconds = (value: number) => Math.round(value * 10) / 10;
const started = performance.now();
const processes = new Map<string, { start: number; seconds: number }>();
const cycles: { era: string; year: number; seconds: number }[] = [];
let lastCycle = started;
const warnings: string[] = [];
const result = await generateAtlas(source, input, {
  diagnostic(d) {
    const where = d.stack?.split("\n").slice(0, 3).join(" | ") ?? "";
    warnings.push(`${d.severity} ${d.code} in ${d.process} (${d.outcome}): ${d.message} ${where}`);
  },
  progress(path, _fraction, message) {
    const now = performance.now();
    if (process.env.TRACE && /human|Societies|Skipped/.test(message))
      console.log(`+${seconds((now - started) / 1000)}s ${path.join("/")} ${message}`);
    const starting = /^Starting (\S+)/.exec(message),
      completed = /^Completed (\S+)/.exec(message),
      cycle = /^(.+?): year (\d+) of (\d+)/.exec(message);
    if (starting) processes.set(starting[1], { start: now, seconds: 0 });
    else if (completed && processes.has(completed[1]))
      processes.get(completed[1])!.seconds += (now - processes.get(completed[1])!.start) / 1000;
    else if (cycle) {
      cycles.push({ era: cycle[1], year: Number(cycle[2]), seconds: (now - lastCycle) / 1000 });
      lastCycle = now;
    }
    if (starting || cycle) lastCycle = now;
  },
});
if (warnings.length) console.log("DIAGNOSTICS\n" + warnings.join("\n"));
const snapshot = generationSnapshot(result, input, crypto.randomUUID());
const inventory = societyInventory(snapshot, input.areaId);

console.log(
  `world ${draft.width / 1000} x ${draft.height / 1000} km, seed ${draft.recipe.seed}, ${draft.recipe.quality}; ${seconds((performance.now() - started) / 1000)} s total`
);
console.log("eras", JSON.stringify(source.world.humanEras));
console.log("\nTIMING (seconds per human process)");
console.table(
  [...processes]
    .filter(([id]) => id.startsWith("human."))
    .map(([id, t]) => ({ process: id, seconds: seconds(t.seconds) }))
);
const byEra = new Map<string, number[]>();
for (const c of cycles) byEra.set(c.era, [...(byEra.get(c.era) ?? []), c.seconds]);
console.table(
  [...byEra].map(([era, s]) => ({
    era,
    cycles: s.length,
    secondsPerCycle: seconds(s.reduce((a, b) => a + b, 0) / s.length),
    maxSeconds: seconds(Math.max(...s)),
  }))
);

console.log("\nPEOPLE");
console.log(
  `communities ${inventory.communities}, inhabited ${inventory.inhabited}; capacity ${inventory.capacity}, people ${inventory.people} (fill ${(inventory.people / Math.max(1, inventory.capacity)).toFixed(2)}), urban ${inventory.urban} (urbanization ${inventory.urbanization})`
);
console.table(inventory.eras);
console.log("quantiles over inhabited communities: min, q25, median, q75, q90, max");
console.table(
  Object.entries(inventory.quantiles).map(([measure, q]) => ({
    measure,
    min: q[0],
    q25: q[1],
    median: q[2],
    q75: q[3],
    q90: q[4],
    max: q[5],
  }))
);
console.log("published settlement sizes by role (largest first)");
for (const [role, sizes] of Object.entries(inventory.sizesByRole))
  console.log(
    `  ${role.padEnd(16)} ${sizes.length.toString().padStart(3)}: ${sizes.slice(0, 12).join(", ")}`
  );
console.log("largest settlements");
console.table(inventory.largest);

console.log("\nROUTES");
console.log(JSON.stringify(inventory.routes));
