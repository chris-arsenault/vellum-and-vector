import { requireChannel } from "@atlas/domain";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect } from "vitest";
import {
  gridPosition,
  rectangle,
  regionRefinementInput,
  refinedRegionArea,
  type AtlasFeature,
  type DomainSnapshot,
  type Grid,
} from "@atlas/domain";
import {
  generateAtlas,
  generationSnapshot,
  refineRegionalMap,
  type CompletedBoundary,
} from "@atlas/generation";
import { generationStorageFixture } from "../../../packages/storage-browser/src/generationFixture";
import { newGenerationDraft, prepareDraft } from "../generationDraft";
import { executeWorkspaceCommand } from "../workspaceCommands";
import { fixtureState, fixtureWorkspace, registerWorldSnapshot } from "./workspaceFixture";
import { regionalWorkload, type RegionalWorkloadOutput } from "./regionalWorkload";
import { regionalOverview, regionalReliefOverview } from "./regionalOverview";
import {
  constructedSelections,
  evaluationSeed,
  mountainCountry,
  plateauCountry,
} from "./regionalParents";
import { supplyParentWorld } from "./regionalParentWorld";

/**
 * The frozen regional evaluation (spec section 9.1): four paired cases, one fixed seed,
 * fixed selections and one fixed presentation. P1 and P2 are constructed at the coarse
 * world sampling scale (`regionalParents.ts`); M1 and M2 are selected from one generated
 * draft world by their parent conditions. The variant name separates baseline renders from
 * candidate renders.
 */
export { evaluationSeed, constructedSelections, mountainCountry, plateauCountry };
export const evaluationDirectory = ".artifacts/regional/evaluation";
export const evaluationVariant = process.env.ATLAS_REGIONAL_VARIANT ?? "candidate";

type Fixture = Parameters<typeof regionalWorkload>[0];
export interface CaseRecord {
  case: string;
  variant: string;
  samples: number;
  runsMs: number[];
  medianMs: number;
  deterministic: boolean;
  counts: Record<string, number>;
  phases?: Record<string, number>;
  note?: string;
}

async function selectRegion(
  parent: DomainSnapshot,
  workspace: Awaited<ReturnType<typeof fixtureWorkspace>>,
  name: string,
  footprint: ReturnType<typeof rectangle>
): Promise<Fixture> {
  const id = parent.world.id,
    root = parent.scope.areaId,
    regionId = crypto.randomUUID(),
    scope = { worldId: id, areaId: root, spaceId: parent.scope.spaceId };
  let world = await workspace.catalog.readEditor(id);
  const command = async (kind: string, data: Record<string, unknown>) => {
    await executeWorkspaceCommand(
      workspace.catalog,
      workspace.resources,
      {
        scope,
        preview: false,
        command: { operationId: crypto.randomUUID(), expectedVersion: world.version, kind, data },
      },
      workspace.working.cache
    );
    world = await workspace.catalog.readEditor(id);
  };
  await command("putView", {
    id: regionId,
    name,
    areaId: root,
    layers: [],
    region: { parentId: null, footprint },
  });
  await command("createArea", regionRefinementInput(world, regionId));
  const child = refinedRegionArea(world, regionId)!.id;
  return { id, root, child, workspace, parent, current: () => fixtureState(id).snapshot };
}

/** P1 or P2 through the real selection and capture path. */
export async function constructedCase(id: "P1" | "P2") {
  const parent = supplyParentWorld(id === "P1" ? mountainCountry() : plateauCountry());
  registerWorldSnapshot(parent);
  const workspace = await fixtureWorkspace(parent.world.id);
  return selectRegion(parent, workspace, id, rectangle(constructedSelections[id]));
}

/** One generated draft world shared by the magical cases; the production handoff path. */
export async function generatedWorld() {
  const storage = await generationStorageFixture(),
    draft = newGenerationDraft();
  draft.width = 2_000_000;
  draft.height = 1_000_000;
  draft.recipe.quality = "draft";
  draft.recipe.seed = evaluationSeed;
  draft.recipe.domains = ["physical", "magic", "cultural", "political", "built"];
  const prepared = prepareDraft(draft);
  expect(prepared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  storage.source(prepared.source);
  const started = performance.now(),
    result = await generateAtlas(prepared.source, prepared.input, storage.options),
    worldMs = performance.now() - started,
    published = generationSnapshot(result, prepared.input, "evaluation-world", prepared.source);
  published.world.features = Object.fromEntries(
    [...storage.options.features.values()].map((feature) => [feature.id, feature])
  );
  registerWorldSnapshot(published);
  const workspace = await fixtureWorkspace(published.world.id);
  return {
    published,
    surface: result.state.surface,
    worldMs,
    workspace,
    close: () => storage.close(),
  };
}

/** Per-bin land and coverage totals of the generated world on a 50 km lattice. */
function binnedCoverage(surface: Grid, systems: string[], bin: number) {
  const [w, s, e, n] = surface.bounds,
    columns = Math.ceil((e - w) / bin),
    rows = Math.ceil((n - s) / bin),
    totals = systems.map(() => new Float64Array(columns * rows)),
    land = new Float64Array(columns * rows),
    cells = new Float64Array(columns * rows),
    water = requireChannel(surface, "WaterKindCodes");
  for (let i = 0; i < surface.active.length; i++) {
    const p = gridPosition(surface, i),
      k =
        Math.min(rows - 1, Math.floor((p.y - s) / bin)) * columns +
        Math.min(columns - 1, Math.floor((p.x - w) / bin));
    cells[k]++;
    if (water.get(i) !== 1) land[k]++;
    systems.forEach((id, index) => {
      totals[index][k] += surface.channels[`magic:${id}:coverage`]?.get(i) ?? 0;
    });
  }
  return { columns, rows, totals, land, cells };
}

/**
 * Select a magical case by its parent conditions. Candidate frames of the case's size are
 * placed on a 50 km lattice; a frame qualifies by its land share (mostly land inland, a
 * coast of 35–85 % land when coastal) and by carrying the named systems; the frame with the
 * most of their coverage wins. When no frame carries every named system, the frame with the
 * most of them present wins and the missing ones are recorded.
 */
export function magicSelection(
  surface: Grid,
  systems: string[],
  coastal: boolean,
  halfSize: [number, number]
) {
  const bin = 50_000,
    [w, s] = surface.bounds,
    { columns, rows, totals, land, cells } = binnedCoverage(surface, systems, bin),
    reachX = Math.round(halfSize[0] / bin),
    reachY = Math.round(halfSize[1] / bin),
    qualifies = (share: number) => (coastal ? share >= 0.35 && share <= 0.85 : share >= 0.7),
    frame = (cx: number, cy: number) => {
      const sums = systems.map(() => 0);
      let landCells = 0,
        allCells = 0;
      for (let y = cy - reachY; y < cy + reachY; y++)
        for (let x = cx - reachX; x < cx + reachX; x++) {
          if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
          const k = y * columns + x;
          landCells += land[k];
          allCells += cells[k];
          systems.forEach((_, index) => (sums[index] += totals[index][k]));
        }
      return { share: landCells / Math.max(1, allCells), sums };
    };
  let best: { cx: number; cy: number; sums: number[] } | undefined,
    bestKey = [-1, -1];
  for (let cy = reachY; cy <= rows - reachY; cy++)
    for (let cx = reachX; cx <= columns - reachX; cx++) {
      const { share, sums } = frame(cx, cy);
      if (!qualifies(share)) continue;
      const present = sums.filter((sum) => sum > 0).length,
        value = sums.reduce((sum, total) => sum + Math.log1p(total), 0);
      if (present > bestKey[0] || (present === bestKey[0] && value > bestKey[1])) {
        bestKey = [present, value];
        best = { cx, cy, sums };
      }
    }
  expect(best).toBeDefined();
  const x = w + best!.cx * bin,
    y = s + best!.cy * bin,
    present = systems.filter((_, index) => best!.sums[index] > 0);
  return {
    footprint: rectangle([x - halfSize[0], y - halfSize[1], x + halfSize[0], y + halfSize[1]]),
    present,
  };
}

export async function generatedCase(
  world: Awaited<ReturnType<typeof generatedWorld>>,
  id: "M1" | "M2"
) {
  const systems = id === "M1" ? ["fire", "aurora"] : ["pressure", "greenwood", "salt", "hallowed"],
    selection = magicSelection(world.surface, systems, id === "M2", [200_000, 150_000]),
    fixture = await selectRegion(world.published, world.workspace, id, selection.footprint);
  return { fixture, present: selection.present, systems };
}

/** Three runs of one captured case: the median time, a determinism check and the renders. */
export async function evaluateCase(f: Fixture, id: string, note?: string): Promise<CaseRecord> {
  const runs: RegionalWorkloadOutput[] = [];
  let rendered: { result: CompletedBoundary; features: AtlasFeature[] } | undefined;
  for (let run = 0; run < 3; run++) {
    const workload = await regionalWorkload(f, f.child, "standard");
    try {
      const result = await refineRegionalMap(workload.source, workload.input, workload.options),
        output = await workload.publish(result);
      runs.push(output);
      if (run === 0) rendered = { result, features: [...workload.features.values()] };
    } finally {
      await workload.close();
    }
    if (run === 0 && rendered) {
      const directory = `${evaluationDirectory}/${evaluationVariant}`;
      await regionalOverview(rendered.result, rendered.features, `${id}-overview`, directory);
      await regionalReliefOverview(rendered.result, `${id}-relief`, directory);
    }
  }
  const times = runs.map((run) => run.generationMs).sort((a, b) => a - b),
    signatures = runs.map((run) => JSON.stringify(run.signature));
  if (signatures.some((signature) => signature !== signatures[0]))
    console.warn(
      `${id} signatures differ between runs:`,
      runs.map((run) => run.signature)
    );
  return {
    case: id,
    variant: evaluationVariant,
    samples: runs[0].samples,
    runsMs: times,
    medianMs: times[1],
    deterministic: signatures.every((signature) => signature === signatures[0]),
    counts: runs[0].counts,
    phases: Object.fromEntries(
      Object.entries(runs[0].phases).map(([phase, ms]) => [phase, Math.round(ms)])
    ),
    ...(note ? { note } : {}),
  };
}

/** Records merge by case, so a partial rerun keeps the other cases' numbers. */
export async function writeEvaluationReport(records: CaseRecord[], worldMs: number | null) {
  const directory = `${evaluationDirectory}/${evaluationVariant}`,
    path = `${directory}/report.json`;
  await mkdir(directory, { recursive: true });
  let previous: { worldMs: number | null; cases: CaseRecord[] } = { worldMs: null, cases: [] };
  try {
    previous = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // No earlier report for this variant.
  }
  const cases = [
    ...previous.cases.filter((record) => !records.some((next) => next.case === record.case)),
    ...records,
  ].sort((a, b) => a.case.localeCompare(b.case));
  await writeFile(
    path,
    JSON.stringify(
      {
        variant: evaluationVariant,
        seed: evaluationSeed,
        worldMs: worldMs ?? previous.worldMs,
        cases,
      },
      null,
      2
    )
  );
}
