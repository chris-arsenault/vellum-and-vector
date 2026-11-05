import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { atlasEpoch } from "../../../packages/generation/src/canonry/atlasProfile";
import { physicalContext } from "../../../packages/generation/src/canonry/context";
import {
  applyNativeStep,
  nativeContracts,
  observeNativeSteps,
} from "../../../packages/generation/src/canonry/contracts";
import type { PhysicalField } from "../../../packages/generation/src/canonry/field";
import { physicalProfile } from "../../../packages/generation/src/canonry/profile";
import { physicalSchedule } from "../../../packages/generation/src/canonry/schedule";
import { defaultEpochs } from "../worldCreation";
import { restoreSnapshot, snapshotPath } from "./fieldSnapshot";
import { harnessRoot } from "./harnessWorkspace";
import { reliefProbes } from "./reliefProbes";
import { beltSupply, landHeights, moveBudget, stuckRootCrust } from "./reliefSupply";
import {
  drawHeights,
  drawSystems,
  highGroundAtEdge,
  landSlopes,
  mountainSystems,
  widthsAbove,
} from "./reliefSystems";

/**
 * Runs the world's real physical sequence again from a saved pass, with nothing generated:
 * `HARNESS_STAGES=stages HARNESS_PASS=1 HARNESS_UNTIL=crustal-support pnpm --dir frontend harness
 * stageReplay`. Magic and ecology do not run, and a pass's steps run as the world's schedule lists
 * them. Writes each step's probes and, when a later snapshot exists, how far the replay ended from
 * what the full run recorded.
 */
const out = join(harnessRoot, process.env.HARNESS_OUT ?? "replay.json");

/** Values under tuning that a world does not scale to its size, so the code's own apply as they are. */
const reliefValues = [
  "OrogenicSurfaceReliefSharePerMille",
  "MaximumOrogenicSurfaceReliefPerPass",
  "OrogenicAccretionRatio",
  "OrogenicPlateauWidth",
  "OrogenicPlateauShare",
  "BedrockLoadResponsePerMille",
  "LithosphericFlexureLength",
  "FluvialChannelArea",
  "FluvialEquilibriumGradient",
  "ThrustRampHeight",
  "ThrustSlipPerSheetWidth",
  "ThrustTiltPerCell",
] as const;
/** The world's epochs, the last repeated as often as a run of more passes needs. */
function epochsFor(passes: number) {
  // A trial of other tectonic strengths, one per epoch: HARNESS_TECTONICS="1,0.4,0.1".
  const trial = process.env.HARNESS_TECTONICS?.split(",").map(Number),
    epochs = defaultEpochs().map((epoch, n) =>
      atlasEpoch({ ...epoch, tectonics: trial?.[n] ?? epoch.tectonics })
    );
  while (epochs.length < passes) epochs.push(epochs[epochs.length - 1]);
  return epochs;
}
function runPass(
  map: PhysicalField,
  seed: number,
  profile: Parameters<typeof physicalContext>[2],
  pass: number,
  until: string,
  total: number
) {
  const epochs = epochsFor(total),
    schedule = physicalSchedule(epochs).filter((entry) => entry.index === pass && entry.epoch);
  for (const { step, epoch, index } of schedule) {
    const contract = { ...nativeContracts[step[0]], requires: [] },
      context = physicalContext(seed, step[1], profile, epoch, index, epochs.length);
    applyNativeStep(map, context, step, contract);
    if (step[0] === until) return;
  }
}
function differenceFrom(map: PhysicalField, path: string) {
  const { map: recorded } = restoreSnapshot(path);
  let total = 0,
    cells = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    total += ((map.Elevation.get(i) - recorded.Elevation.get(i)) / 1024) ** 2;
    cells++;
  }
  return Math.round(Math.sqrt(total / cells));
}
it.runIf(process.env.HARNESS_STAGES)(
  "replays a pass of the world from a snapshot",
  () => {
    const label = process.env.HARNESS_STAGES!,
      pass = Number(process.env.HARNESS_PASS ?? 1),
      until = process.env.HARNESS_UNTIL ?? "",
      { map, seed, profile: saved } = restoreSnapshot(snapshotPath(label, pass)),
      // The snapshot holds the values it ran with; relief's own come from the code as it is now,
      // and a trial of others needs no change to it: HARNESS_PROFILE='{"Name": 1}'.
      profile = {
        ...saved,
        ...Object.fromEntries(reliefValues.map((name) => [name, physicalProfile[name]])),
        ...JSON.parse(process.env.HARNESS_PROFILE ?? "{}"),
      },
      probes = reliefProbes(),
      stages: object[] = [],
      slopes: object[] = [],
      started = performance.now();
    const landAtStart = landHeights(map),
      before = moveBudget(map);
    observeNativeSteps((name, field, context) => {
      probes.observe(name, field, context);
      slopes.push({ name, ...landSlopes(field) });
      if (name === "plate-advection") stages.push({ name, move: moveBudget(field), before });
      const watched = name === "orogenic-construction" || name === "lithospheric-flexure";
      if (watched)
        stages.push({
          name,
          supply: beltSupply(field),
          stuck: stuckRootCrust(field),
          land: landHeights(field),
        });
    });
    const count = Number(process.env.HARNESS_PASSES ?? 1),
      everyPass: object[] = [];
    try {
      for (let at = pass; at < pass + count; at++) {
        runPass(map, seed, profile, at, until, pass + count);
        everyPass.push({
          pass: at,
          land: landHeights(map),
          crust: moveBudget(map).continentalCrust,
        });
      }
    } finally {
      observeNativeSteps(null);
    }
    const result = {
      pass,
      seconds: Math.round((performance.now() - started) / 1000),
      elevationFromRecordedRun:
        until || count !== 1 ? null : differenceFrom(map, snapshotPath(label, pass + 1)),
      startLand: landAtStart,
      endLand: landHeights(map),
      systems: mountainSystems(map),
      edge: highGroundAtEdge(map),
      widths: widthsAbove(map),
      slopes,
      everyPass,
      stages,
      ...probes.read(),
    };
    writeFileSync(out, JSON.stringify(result, null, 1));
    drawSystems(map, harnessRoot, "replay-systems.png");
    drawHeights(map, harnessRoot, "replay-heights.png");
    process.stdout.write(`\nreplay: ${out} in ${result.seconds} s\n`);
  },
  1_800_000
);
