import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { it } from "vitest";
import { groundOf } from "../../../packages/generation/src/rock/ground";
import { erodeFacets } from "../../../packages/generation/src/rock/groundLedger";
import {
  finishGroundImport,
  importGroundBand,
} from "../../../packages/generation/src/rock/groundResources";
import {
  holdRock,
  landCollisionPackage,
  releaseHeldRock,
  watchGroundTransfers,
} from "../../../packages/generation/src/rock/groundTransport";
import { compileMix } from "../../../packages/generation/src/rock/modes";
import { layDownPackage } from "../../../packages/generation/src/rock/rockColumn";
import {
  columnFields,
  columns,
  materialProperties,
  type Column,
  type MaterialLayer,
} from "../../../packages/generation/src/rock/rockLayerFields";
import {
  createField,
  type PhysicalBufferName,
  type PhysicalField,
} from "../../../packages/generation/src/world/field";
import { createMesh } from "../../../packages/generation/src/world/mesh";
import { plateAdvection } from "../../../packages/generation/src/world/advection";
import { atlasEpoch } from "../../../packages/generation/src/world/atlasProfile";
import {
  physicalContext,
  type PhysicalContext,
} from "../../../packages/generation/src/world/context";
import {
  applyNativeStep,
  withPlateDeformation,
} from "../../../packages/generation/src/world/physicalSteps";
import { plateTravel } from "../../../packages/generation/src/world/tectonicControls";
import { tectonicInterval } from "../../../packages/generation/src/world/tectonicIntegration";
import { restoreSnapshot, snapshotPath } from "./fieldSnapshot";
import { writeGroundSection } from "./groundSection";
import { harnessRoot } from "./harnessWorkspace";
import { write } from "./harness";
import { groundProbeCells } from "./groundProbe";
import { startProcessProbe } from "./processProbe";
import { nativeWorkload } from "./nativeWorkload";

type Section = ReturnType<ReturnType<typeof groundOf>["section"]>;
interface Captured {
  source: number;
  target: number;
  accepted: number;
  donor: {
    placement: Record<"BedrockElevation" | "CrustSupportElevation" | "SurfaceRockLoad", number>;
    cutShare: number;
    cutDepth: number;
    columns: Record<Column, MaterialLayer[]>;
  };
  destination: { elevation: number; land: Section; cut: Section };
}
interface Imported {
  columns: Record<Column, readonly MaterialLayer[]>;
  bedrock: number;
  support: number;
  load: number;
  cutShare: number;
  cutDepth: number;
}
const run = process.env.HARNESS_CAPTURED_RUN ?? "ground-authority-a2",
  output = join(harnessRoot, process.env.HARNESS_OUT ?? "ground-captured");

function records(label: string, indices: readonly number[]) {
  return indices.map((index) => {
    const first = Math.floor(index / 128) * 128,
      file = `records-${String(first).padStart(9, "0")}.json`,
      path = join(harnessRoot, "ground-observations", label, file);
    return (JSON.parse(readFileSync(path, "utf8")) as Captured[])[index - first];
  });
}
function recipient(record: Captured): Imported {
  const { land, cut } = record.destination,
    rock = (layers: Section) => layers.filter((layer) => layer.medium === "rock"),
    loose = (layers: Section) => layers.filter((layer) => layer.medium === "loose"),
    cutShare = cut[0]?.share ?? 0,
    cutDepth = cut.length ? rock(land)[0].top - rock(cut)[0].top : 0,
    bedrock = rock(land)[0].top - cutShare * cutDepth;
  return {
    columns: { land: rock(land), loose: loose(land), cut: rock(cut), cutLoose: loose(cut) },
    bedrock,
    support: bedrock,
    load: 0,
    cutShare,
    cutDepth,
  };
}
function donor(record: Captured): Imported {
  const source = record.donor;
  return {
    columns: source.columns,
    bedrock: source.placement.BedrockElevation,
    support: source.placement.CrustSupportElevation,
    load: source.placement.SurfaceRockLoad,
    cutShare: source.cutShare,
    cutDepth: source.cutDepth,
  };
}
/** Reconstruct supplied observations through the production import boundary, never writable views. */
function restore(map: PhysicalField, supplied: readonly Imported[]) {
  const imported = new Set<PhysicalBufferName>(),
    at = (cell: number) => supplied[cell % supplied.length],
    copy = (name: Parameters<typeof importGroundBand>[1], value: (cell: number) => number) => {
      importGroundBand(map, name, value);
      imported.add(name);
    };
  for (const column of columns)
    for (const property of materialProperties)
      columnFields[column][property].forEach((name, slot) =>
        copy(name, (cell) => at(cell).columns[column][slot]?.[property] ?? 0)
      );
  copy("BedrockElevation", (cell) => at(cell).bedrock);
  copy("CrustSupportElevation", (cell) => at(cell).support);
  copy("SurfaceRockLoad", (cell) => at(cell).load);
  copy("GroundCutShare", (cell) => at(cell).cutShare);
  copy("GroundCutDepth", (cell) => at(cell).cutDepth);
  finishGroundImport(map, imported);
}
function abrasion(map: PhysicalField, cell: number, power: number, limit: number) {
  const ground = groundOf(map),
    before = ground.section(cell),
    depths = ground.surfaceAction(cell, compileMix({ abrasion: 1 }), power, limit),
    parcels: MaterialLayer[] = [],
    removed = erodeFacets(map, cell, depths, "fluvial", "load", (layer) => parcels.push(layer));
  return {
    powerMetres: power,
    limitMetres: limit / 1024,
    depths,
    removed,
    parcels,
    before,
    after: ground.section(cell),
  };
}
function behavior() {
  const [initial, ...arrivals] = records(run, [326, 327, 335, 339]),
    map = createField(createMesh(4, 0)),
    ground = groundOf(map);
  restore(map, [recipient(initial)]);
  for (const cell of [1, 2, 3])
    for (const arrival of arrivals)
      layDownPackage(
        map,
        cell,
        "land",
        arrival.destination.land.filter((layer) => layer.medium === "rock").slice(0, 2)
      );
  const limestone = ground.section(1).find((layer) => layer.kind === 3);
  if (!limestone) throw new Error("Captured limestone contact was lost during insertion.");
  const toContact = ground.section(1)[0].top - limestone.top,
    exposure = [2, 3].map((cell) => abrasion(map, cell, 1_000_000, toContact)),
    nextWear = abrasion(map, 3, 20, 100 * 1024);
  writeGroundSection(map, `${output}-behavior`, "0,1,2,3");
  return {
    sourceRun: run,
    records: [326, 327, 335, 339],
    interpretation:
      "Parallel inspection states, not adjacent geography: cell0 initial; cell1 after three captured landed packages; cell2 explicit abrasion exposing limestone; cell3 its next abrasion. Contact-depth removal is an experiment, not a naturally generated erosion history. Package insertion holds datum fixed to isolate column capacity.",
    sourceIds: arrivals.map((record) => record.source),
    targetId: initial.target,
    exposure,
    nextWear,
  };
}
function collisionCost(label: string, beforeIndex: number, afterIndex: number, batches: number) {
  const [before, after] = records(label, [beforeIndex, afterIndex]),
    source = donor(before),
    receiver = recipient(before),
    constructionStart = performance.now(),
    map = createField(createMesh(4, 0)),
    constructionMs = performance.now() - constructionStart,
    areaRatio = after.accepted / source.load;
  restore(map, [source, receiver]);
  const holdStart = performance.now(),
    held = holdRock(map),
    holdMs = performance.now() - holdStart;
  let importMs = 0,
    operationMs = 0;
  try {
    for (let batch = 0; batch < batches; batch++) {
      let started = performance.now();
      restore(map, [source, receiver]);
      importMs += performance.now() - started;
      started = performance.now();
      landCollisionPackage(map, held, 1, 0, areaRatio, [1, 0, 0, 1]);
      operationMs += performance.now() - started;
    }
    return {
      sourceRun: label,
      beforeIndex,
      afterIndex,
      sourceId: before.source,
      targetId: before.target,
      batches,
      constructionMs,
      holdMs,
      operationMs,
      operationMicroseconds: (operationMs * 1000) / batches,
      importMs,
      sourceDepth: source.load,
      accepted: after.accepted,
      areaRatio,
      resultingSection: groundOf(map).section(1),
    };
  } finally {
    releaseHeldRock(map, held);
  }
}
it.runIf(process.env.HARNESS_CAPTURED)(
  "inspects captured column behavior and collision cost",
  () => {
    mkdirSync(harnessRoot, { recursive: true });
    const batches = Number(process.env.HARNESS_CAPTURED_BATCHES ?? 1000);
    if (!Number.isInteger(batches) || batches <= 0)
      throw new Error("Positive batch count required.");
    const result = {
      behavior: behavior(),
      costInterpretation:
        "Recorded donor/recipient material in a four-cell canonical field. Receiver support equals captured bedrock and starting surface load is zero because those components were not observed. Donor placement is recorded. Missing deformation uses identity. Each operation starts from the same imported input; reset/import is timed separately. This is an operator workload, not exact world replay or geographic acceptance.",
      costs: [
        collisionCost(run, 326, 327, batches),
        collisionCost(run, 7196, 7197, batches),
        collisionCost(run, 45286, 45287, batches),
        collisionCost("ground-authority-b2", 1936, 1937, batches),
      ],
    };
    writeFileSync(`${output}.json`, JSON.stringify(result, null, 2));
    process.stdout.write(`\nCaptured ground observations: ${output}.json\n`);
    process.stdout.write(
      `${JSON.stringify(
        result.costs.map((cost) => ({
          sourceRun: cost.sourceRun,
          beforeIndex: cost.beforeIndex,
          batches: cost.batches,
          constructionMs: cost.constructionMs,
          holdMs: cost.holdMs,
          operationMs: cost.operationMs,
          operationMicroseconds: cost.operationMicroseconds,
          importMs: cost.importMs,
        }))
      )}\n`
    );
  },
  120_000
);

function movementObserver(count: number) {
  const counts = {
      operations: {
        "plate-placement": 0,
        "rock-accretion": 0,
        "cover-accretion": 0,
        "sheet-move": 0,
      },
      acceptedRock: 0,
      acceptedCover: 0,
      sourceChanges: 0,
    },
    cells = new Set(Array.from({ length: count }, (_, cell) => cell));
  let previousSource = -1;
  const stop = watchGroundTransfers(cells, (event) => {
    if (event.phase !== "after") return;
    counts.operations[event.operation]++;
    if (event.operation === "rock-accretion") {
      if ((event.accepted ?? 0) > 0) counts.acceptedRock++;
      if (event.source !== previousSource) counts.sourceChanges++;
      previousSource = event.source;
    }
    if (event.operation === "cover-accretion" && (event.accepted ?? 0) > 0) counts.acceptedCover++;
  });
  return { counts, stop };
}

function intervalObservation(map: PhysicalField) {
  const cells = groundProbeCells(process.env.HARNESS_GROUND_CELLS ?? "");
  if (!cells.length) return movementObserver(map.mesh.count);
  return {
    counts: {
      transferCounts: "Unobserved: selected-site material probe owns the transfer observer.",
      selectedCells: cells,
    },
    stop: startProcessProbe(undefined, undefined, () => {}, {
      cells,
      publish: (samples) => write(dirname(output), `${basename(output)}-ground`, samples),
    }),
  };
}
function runInterval(
  map: PhysicalField,
  context: PhysicalContext,
  epochs: NonNullable<ReturnType<typeof restoreSnapshot>["epochs"]>,
  construction: boolean
) {
  let intervals = 0;
  const after = () => intervals++;
  if (construction) {
    const entry = nativeWorkload(epochs).find(
      (candidate) =>
        candidate.step[0] === "plate-advection" && candidate.epochIndices[0] === context.EpochIndex
    );
    if (!entry) throw new Error("Saved epoch has no selected plate-advection step.");
    applyNativeStep(
      map,
      withPlateDeformation(map, { ...context, AfterPlateStep: after }, entry.deformation),
      entry.step
    );
  } else plateAdvection(map, context, after);
  return intervals;
}

it.runIf(process.env.HARNESS_CAPTURED_INTERVAL)(
  "measures one movement interval from a saved real field",
  () => {
    const label = process.env.HARNESS_CAPTURED_INTERVAL!,
      pass = Number(process.env.HARNESS_PASS ?? 0),
      importStarted = performance.now(),
      { map, seed, profile, epochs } = restoreSnapshot(snapshotPath(label, pass)),
      importMs = performance.now() - importStarted;
    if (!epochs?.[pass] || !map.tectonics)
      throw new Error("Movement interval requires recorded epochs and tectonic state.");
    const original = physicalContext(
        seed,
        0,
        profile,
        atlasEpoch(epochs[pass]),
        pass,
        epochs.length
      ),
      rate =
        plateTravel(profile, original.TectonicDurationMyr, original.TectonicStrength) /
        original.TectonicDurationMyr,
      durationMyr = tectonicInterval(map, original.TectonicDurationMyr, rate),
      interval = {
        ...original,
        TectonicDurationMyr: durationMyr,
        Span: (original.Span * durationMyr) / original.TectonicDurationMyr,
      },
      construction = process.env.HARNESS_CAPTURED_CONSTRUCTION === "1",
      observer = intervalObservation(map);
    let intervals = 0,
      operationMs = 0,
      observationWriteMs = 0;
    const memoryBefore = process.memoryUsage(),
      started = performance.now();
    try {
      intervals = runInterval(map, interval, epochs, construction);
      operationMs = performance.now() - started;
    } finally {
      const writeStarted = performance.now();
      observer.stop();
      observationWriteMs = performance.now() - writeStarted;
    }
    const result = {
      interpretation:
        "Saved-field first-interval diagnostic. Original epoch/profile determine duration and travel rate; Span is proportional. Construction opt-in runs the selected native plate step with its actual embedded deformation steps. This does not complete an epoch or establish geographic acceptance. Selected-site material observations replace all-field event counts when requested; writing observations is outside operation timing.",
      construction,
      snapshot: label,
      pass,
      cells: map.mesh.count,
      seed,
      importMs,
      operationMs,
      observationWriteMs,
      intervals,
      originalDurationMyr: original.TectonicDurationMyr,
      originalSpan: original.Span,
      durationMyr,
      span: interval.Span,
      travelRate: rate,
      ...observer.counts,
      memoryBefore,
      memoryAfter: process.memoryUsage(),
      maxRssKiB: process.resourceUsage().maxRSS,
    };
    mkdirSync(harnessRoot, { recursive: true });
    writeFileSync(`${output}-interval.json`, JSON.stringify(result, null, 2));
    process.stdout.write(
      `\nMovement interval: ${output}-interval.json\n${JSON.stringify(result)}\n`
    );
  },
  1_800_000
);
