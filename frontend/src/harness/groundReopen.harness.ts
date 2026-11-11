import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import {
  gridSampler,
  MapScale,
  resampleChannels,
  type DomainSnapshot,
  type Grid,
} from "@atlas/domain";
import { FieldWorkingSet } from "@atlas/storage-browser";
import type { GenerationState } from "../../../packages/generation/src/process";
import { physicalChannels } from "../../../packages/generation/src/world/atlasChannels";
import {
  createAtlasWorkspace,
  nativePosition,
} from "../../../packages/generation/src/world/atlasWorkspace";
import { groundOf } from "../../../packages/generation/src/rock/ground";
import { erodeFacets } from "../../../packages/generation/src/rock/groundLedger";
import { compileMix } from "../../../packages/generation/src/rock/modes";
import type { MaterialLayer } from "../../../packages/generation/src/rock/rockColumn";
import { groundResourceChannels } from "../../../packages/generation/src/rock/groundResources";
import { generationSource } from "../workspaceGeneration";
import { groundProbeCells } from "./groundProbe";
import { writeGroundSection } from "./groundSection";
import {
  checkpointDirectory,
  harnessRoot,
  openHarnessWorkspace,
  readCheckpoint,
  type HarnessWorkspace,
} from "./harnessWorkspace";
import { openTerrain } from "./mapReport";

/** Read committed map resources into the same input grids the generation workspace consumes. */
async function loadFields(domain: DomainSnapshot, working: FieldWorkingSet, ws: HarnessWorkspace) {
  const channels = new Set(["BaseSeaLevel", ...physicalChannels.map(({ name }) => name)]);
  for (const field of domain.world.fields) {
    if (!field.resourceId || field.input) continue;
    const names = (field.channels ?? []).filter((name) => channels.has(name));
    if (!names.length) continue;
    const resource = await ws.resources.describe(field.resourceId);
    domain.numerical[field.id] = await working.load(field.resourceId, names, {
      id: resource.field!.geographyId,
      scope: resource.scope,
    });
  }
}
type Work = ReturnType<typeof createAtlasWorkspace>;
function capturedPackages(domain: DomainSnapshot, work: Work, cells: readonly number[]) {
  const sources = new Map<string, Grid>();
  for (const field of domain.world.fields) {
    const grid = domain.numerical[field.id];
    if (!grid || field.input) continue;
    for (const name of Object.keys(grid.channels)) sources.set(name, grid);
  }
  const result = cells.map((cell) => ({ cell, channels: {} as Record<string, number> }));
  for (const binding of groundResourceChannels) {
    const grid = sources.get(binding.name);
    if (!grid) throw new Error(`Completed map lacks ground channel ${binding.name}.`);
    const sample = gridSampler(grid, binding.name, true);
    for (const entry of result)
      entry.channels[binding.name] = sample(nativePosition(work, entry.cell));
  }
  return result;
}
function section(work: Work, cell: number) {
  const map = work.map,
    ground = groundOf(map);
  return {
    cell,
    position: nativePosition(work, cell),
    elevation: map.Elevation.get(cell),
    bedrockElevation: map.BedrockElevation.get(cell),
    supportElevation: map.CrustSupportElevation.get(cell),
    rockLoad: map.SurfaceRockLoad.get(cell),
    cutShare: map.GroundCutShare.get(cell),
    cutDepth: map.GroundCutDepth.get(cell),
    land: ground.section(cell, "land"),
    cut: ground.section(cell, "cut"),
  };
}
function wear(work: Work, cells: readonly number[]) {
  const map = work.map,
    ground = groundOf(map),
    mix = compileMix({ abrasion: 1 }),
    power = Number(process.env.HARNESS_WEAR_POWER ?? 100),
    limit = MapScale.inUnits(Number(process.env.HARNESS_WEAR_METRES ?? 25), "native");
  if (!(power > 0 && limit > 0)) throw new Error("Wear power and limit must be positive.");
  return cells.map((cell) => {
    const before = section(work, cell),
      depths = ground.surfaceAction(cell, mix, power, limit),
      parcels: MaterialLayer[] = [],
      removed = erodeFacets(map, cell, depths, "fluvial", "load", (layer) => parcels.push(layer));
    return {
      cell,
      powerMetres: power,
      limitMetres: MapScale.metres(limit, "native"),
      depths,
      removed,
      parcels,
      before,
      after: section(work, cell),
    };
  });
}

/** Reopens completed geography and acts only on a transient owning field; never saves the checkpoint. */
it.runIf(process.env.HARNESS_GROUND_REOPEN)(
  "inspects saved material and its next owner wear",
  async () => {
    const name = process.env.HARNESS_GROUND_REOPEN!,
      record = readCheckpoint(name),
      selection = process.env.HARNESS_GROUND_CELLS ?? "",
      cells = groundProbeCells(selection);
    if (!record) throw new Error(`No completed checkpoint named ${name}.`);
    if (!cells.length) throw new Error("Select bounded HARNESS_GROUND_CELLS for reopening.");
    const ws = await openHarnessWorkspace(checkpointDirectory(name)),
      working = new FieldWorkingSet(ws.resources, ws.working.cache);
    try {
      const area = record.child ?? record.root,
        domain = await generationSource(ws.catalog, record.worldId, area),
        terrain = await openTerrain(ws, record.worldId, area);
      try {
        await loadFields(domain, working, ws);
        const datum = Object.values(domain.numerical).find((grid) => grid.channels.BaseSeaLevel);
        if (datum) resampleChannels(datum, terrain.raster.field, ["BaseSeaLevel"]);
        const state: GenerationState = {
          domain,
          surface: terrain.raster.field,
          cache: ws.working.cache,
          facts: new Set(["geography:reopened"]),
          history: [],
        };
        const work = createAtlasWorkspace(state, record.quality as "draft"),
          stem = join(harnessRoot, `${name}-reopened`);
        if (cells.some((cell) => cell >= work.map.mesh.count))
          throw new Error("Selected cell is outside the reopened map.");
        const publishedBefore = capturedPackages(domain, work, cells);
        writeGroundSection(work.map, `${stem}-before`, selection);
        const actions = wear(work, cells),
          publishedAfter = capturedPackages(domain, work, cells);
        writeGroundSection(work.map, `${stem}-after`, selection);
        writeFileSync(
          `${stem}.json`,
          JSON.stringify(
            {
              checkpoint: record,
              interpretation:
                "Completed resources imported through the owning workspace. Explicit abrasion acts only on this transient field; no generation, catalog save or resource write occurs.",
              publishedBefore,
              actions,
              publishedAfter,
            },
            null,
            2
          )
        );
        process.stdout.write(`Reopened ground: ${stem}.json\n`);
      } finally {
        terrain.close();
      }
    } finally {
      working.close();
      await ws.close();
    }
  },
  1_800_000
);
