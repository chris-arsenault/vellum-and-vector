import { writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { it } from "vitest";
import type { Epoch } from "@atlas/domain";
import { atlasEpoch } from "../../../packages/generation/src/world/atlasProfile";
import {
  physicalContext,
  type PhysicalContext,
} from "../../../packages/generation/src/world/context";
import {
  applyNativeStep,
  observeNativeSteps,
  withPlateDeformation,
} from "../../../packages/generation/src/world/physicalSteps";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { physicalProfile } from "../../../packages/generation/src/world/profile";
import { firstEpochGroundChange, firstEpochGroundNow, firstEpochGroundSetting } from "./epochStory";
import { restoreSnapshot, snapshotPath } from "./fieldSnapshot";
import { harnessRoot } from "./harnessWorkspace";
import { writeGroundSection } from "./groundSection";
import { nativeWorkload } from "./nativeWorkload";
import { reliefProbes } from "./reliefProbes";
import { clearLiveMagic, liveMagicForcing } from "./extinctMagic";
import { drawMaterials } from "./materialPicture";
import { rockTrace } from "./rockTrace";
import { inspectWeakLayers } from "./weakLayerInspection";
import { beltSupply, landHeights, moveBudget, stuckRootCrust } from "./reliefSupply";
import {
  drawHeights,
  drawShade,
  drawSystems,
  highGroundAtEdge,
  landSlopes,
  mountainSystems,
  reliefThresholds,
  widthsAbove,
} from "./reliefSystems";

/**
 * Runs the world's real physical sequence again from a saved pass, with nothing generated:
 * `HARNESS_STAGES=stages HARNESS_PASS=1 HARNESS_UNTIL=crustal-support pnpm --dir frontend harness
 * stageReplay`. Magic and ecology do not run, and a pass's steps run as the world's schedule lists
 * them. Writes each step's geographic probes, and what each step did to the first epoch's ground:
 * `oldGround` holds the means at the start and end and where that ground now sits in the plates'
 * work, and `oldGroundSteps` each step that moved a part of its column by a metre or more, by what
 * that ground was in the first epoch. `HARNESS_PASSES=0` reports a snapshot as it stands.
 * `HARNESS_PASS=final HARNESS_EXTINCT_MAGIC=1 HARNESS_PASSES=2` continues the completed world
 * after clearing live magical forcing. Material images use the app's present substrate projection,
 * never historical labels; inspect them and the terrain to judge surviving remnants.
 * `HARNESS_RELIEF_GAIN=15` exaggerates only hillshade gradients, recorded in the report and filename.
 */
const out = join(harnessRoot, process.env.HARNESS_OUT ?? "replay.json");

/** The world's epochs, the last repeated as often as a run of more passes needs. */
function epochsFor(passes: number, saved: Epoch[]) {
  // A trial of other tectonic strengths, one per epoch: HARNESS_TECTONICS="1,0.4,0.1".
  const trial = process.env.HARNESS_TECTONICS?.split(",").map(Number),
    supplied: Epoch[] = process.env.HARNESS_EPOCHS ? JSON.parse(process.env.HARNESS_EPOCHS) : saved,
    epochs = supplied.map((epoch, n) => ({
      ...epoch,
      tectonics: trial?.[n] ?? epoch.tectonics,
    }));
  while (epochs.length < passes)
    epochs.push({ ...epochs[epochs.length - 1], id: `workload-${epochs.length}` });
  return epochs;
}
function runPass(
  map: PhysicalField,
  seed: number,
  profile: Parameters<typeof physicalContext>[2],
  pass: number,
  until: string,
  epochs: Epoch[]
) {
  const schedule = nativeWorkload(epochs).filter((entry) => entry.epochIndices[0] === pass);
  if (!schedule.length)
    throw new Error(`No physical operations selected for continuation epoch ${pass}.`);
  for (const { step, deformation } of schedule) {
    const context = physicalContext(
      seed,
      step[1],
      profile,
      atlasEpoch(epochs[pass], map.scale),
      pass,
      epochs.length
    );
    applyNativeStep(
      map,
      step[0] === "plate-advection" ? withPlateDeformation(map, context, deformation) : context,
      step
    );
    if (step[0] === until) return;
  }
}
/** Follows the first epoch's ground through the steps: what each did to it, and where it then sat. */
function oldGroundWatch(map: PhysicalField) {
  const start = firstEpochGroundNow(map),
    steps: object[] = [];
  let last = start;
  return {
    observe(name: string, field: PhysicalField, context: PhysicalContext) {
      const now = firstEpochGroundNow(field),
        change = firstEpochGroundChange(last, now);
      if (change) steps.push({ name, epoch: context.EpochIndex, ...change });
      if (name === "orogenic-construction")
        steps.push({
          name: "setting",
          epoch: context.EpochIndex,
          ...firstEpochGroundSetting(field),
        });
      last = now;
    },
    read: () => ({
      oldGround: { start, end: last, setting: firstEpochGroundSetting(map) },
      oldGroundSteps: steps,
    }),
  };
}
function saveReport(map: PhysicalField, result: { seconds: number }) {
  const imageName = basename(out, extname(out)),
    reliefGain = Number(process.env.HARNESS_RELIEF_GAIN ?? 1),
    shadeName = `${imageName}-shade${reliefGain === 1 ? "" : `-relief-${reliefGain}x`}.png`;
  writeFileSync(
    out,
    JSON.stringify(
      {
        ...result,
        presentation: { hillshade: { verticalExaggeration: reliefGain, image: shadeName } },
      },
      null,
      1
    )
  );
  drawSystems(map, harnessRoot, `${imageName}-systems.png`);
  drawHeights(map, harnessRoot, `${imageName}-heights.png`, false);
  drawHeights(map, harnessRoot, `${imageName}-contacts.png`);
  drawShade(map, harnessRoot, shadeName, reliefGain);
  drawMaterials(map, harnessRoot, imageName);
  writeGroundSection(map, join(harnessRoot, imageName), process.env.HARNESS_SECTION_CELLS ?? "");
  process.stdout.write(`\nreplay: ${out} in ${result.seconds} s\n`);
}
function selectedSnapshot() {
  const label = process.env.HARNESS_STAGES!,
    requested = process.env.HARNESS_PASS,
    selection =
      requested === "failure" || requested === "final" ? requested : Number(requested ?? 1),
    count = Number(process.env.HARNESS_PASSES ?? 1),
    saved = restoreSnapshot(snapshotPath(label, selection), count === 0),
    pass =
      selection === "failure"
        ? saved.failure!.lastObservedEpoch
        : selection === "final"
          ? saved.epochs.length
          : selection;
  return { ...saved, pass, count };
}
function weakLayerSamples(map: PhysicalField) {
  return process.env.HARNESS_WEAK_LAYERS
    ? {
        weakLayers: inspectWeakLayers(
          map,
          process.env.HARNESS_SECTION_CELLS?.split(",").map(Number)
        ),
      }
    : {};
}
it.runIf(process.env.HARNESS_STAGES)(
  "replays a pass of the world from a snapshot",
  () => {
    const until = process.env.HARNESS_UNTIL ?? "",
      { map, seed, profile: saved, epochs: savedEpochs, failure, pass, count } = selectedSnapshot(),
      profileSource = process.env.HARNESS_PROFILE_SOURCE ?? "snapshot",
      profile = {
        ...(profileSource === "current" ? physicalProfile : saved),
        ...JSON.parse(process.env.HARNESS_PROFILE ?? "{}"),
      },
      probes = reliefProbes(),
      stages: object[] = [],
      slopes: object[] = [],
      oldGround = oldGroundWatch(map),
      rock = rockTrace(),
      started = performance.now();
    const extinctMagic = Boolean(process.env.HARNESS_EXTINCT_MAGIC);
    if (extinctMagic) clearLiveMagic(map);
    const landAtStart = landHeights(map),
      before = moveBudget(map);
    observeNativeSteps((name, field, context) => {
      probes.observe(name, field, context);
      slopes.push({ name, ...landSlopes(field) });
      oldGround.observe(name, field, context);
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
    const epochs = epochsFor(pass + count, savedEpochs),
      everyPass: object[] = [];
    try {
      for (let at = pass; at < pass + count; at++) {
        runPass(map, seed, profile, at, until, epochs);
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
      workload: {
        physicalOnly: true,
        clearedLiveMagic: extinctMagic ? liveMagicForcing : [],
        profileSource,
        profile,
        epochs,
        failure,
      },
      monitoring: { memory: process.memoryUsage(), resourceUsage: process.resourceUsage() },
      pass,
      seconds: Math.round((performance.now() - started) / 1000),
      startLand: landAtStart,
      endLand: landHeights(map),
      classificationThresholdsMetres: reliefThresholds(map.scale),
      systems: mountainSystems(map),
      edge: highGroundAtEdge(map),
      widths: widthsAbove(map),
      slopes,
      everyPass,
      stages,
      rock: rock.read(map),
      ...weakLayerSamples(map),
      ...oldGround.read(),
      ...probes.read(),
    };
    saveReport(map, result);
  },
  1_800_000
);
