import {
  areaSpace,
  createGrid,
  resample,
  spatial,
  semanticId,
  requireThat,
  type DomainSnapshot,
  type Grid,
} from "@atlas/domain";
import { MapRunner, type MapRunnerOptions } from "./mapRunner";
import {
  MapProcessRegistry,
  type GenerationState,
  type MapProcess,
  type ProcessConfiguration,
  type ProcessSequence,
} from "./process";
import { initializeTerrainProcess, tectonicsProcess } from "./mapTerrain";
import {
  resetForcingProcess,
  temperatureProcess,
  precipitationProcess,
  iceBalanceProcess,
} from "./mapClimate";
import { thermalMagicProcess, magicStorageProcess } from "./mapMagic";
import { materialMagicProcess } from "./mapMagicEffects";
import { drainageProcess, erosionProcess } from "./mapHydrology";
import { culturalProcess, politicalProcess } from "./mapPeople";
import { builtProcess } from "./mapBuilt";
import { extractGeographyProcess, prepareGeneratedProcess } from "./mapFeatures";

export interface AtlasGenerationInput {
  areaId: string;
  domains: string[];
  quality: string;
  seed: number;
}
const processes = [
  initializeTerrainProcess,
  tectonicsProcess,
  resetForcingProcess,
  thermalMagicProcess,
  magicStorageProcess,
  temperatureProcess,
  precipitationProcess,
  iceBalanceProcess,
  drainageProcess,
  erosionProcess,
  extractGeographyProcess,
  culturalProcess,
  politicalProcess,
  builtProcess,
  materialMagicProcess,
];

export async function generateAtlas(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  options: Omit<MapRunnerOptions, "seed" | "seedScope"> = {}
) {
  requireThat(
    input.domains.length &&
      input.domains.every((d) =>
        ["physical", "magic", "cultural", "political", "built"].includes(d)
      ),
    "generation_domains",
    "Select at least one generation domain."
  );
  requireThat(Number.isInteger(input.seed), "generation_seed", "Use an integer generation seed.");
  options.progress?.(["prepare"], 0, "Sampling inherited geography");
  const initial = initialState(source, input);
  const registry = processes
    .reduce((r, process) => r.register(process), new MapProcessRegistry())
    .register(prepareGeneratedProcess(input.domains));
  const configuration = atlasConfiguration(source, input);
  return new MapRunner(configuration, registry).run(initial, {
    ...options,
    seed: String(input.seed),
    seedScope: JSON.stringify([
      source.world.areas[input.areaId].profile,
      spatial.bounds(source.world.areas[input.areaId].footprint),
    ]),
  });
}

function initialState(source: DomainSnapshot, input: AtlasGenerationInput): GenerationState {
  const domain = structuredClone(source),
    area = domain.world.areas[input.areaId];
  requireThat(area, "generation_area", "Choose an existing mapped area.");
  const sizes: Record<string, number> = { draft: 48, standard: 96, fine: 192 };
  const size = sizes[input.quality];
  requireThat(size, "generation_quality", "Choose draft, standard or fine detail.");
  const scope = {
    worldId: domain.world.id,
    areaId: area.id,
    spaceId: areaSpace(domain.world, area.id),
    footprint: area.footprint,
    crsId: domain.world.reference.id,
    revision: domain.world.version,
    time: "present",
    resolution: null,
  };
  domain.scope = scope;
  const extent = spatial.bounds(area.footprint);
  // A child keeps its parent's boundary band. Fine numerical work occupies the
  // interior; parent samples remain authoritative at the established interface.
  const band = Math.min(extent[2] - extent[0], extent[3] - extent[1]) / size;
  const interior = area.boundary ? spatial.buffer(area.footprint, -band) : area.footprint;
  requireThat(
    interior && spatial.area(interior) > 0,
    "generation_extent",
    "Choose an extent with room for interior field samples."
  );
  const surface = createGrid(
    semanticId(domain.world.id, "surface", `${area.id}:${input.seed}`),
    { ...scope, footprint: interior },
    size,
    size
  );
  inheritSurface(source, surface, input);
  return { domain, surface, facts: initialFacts(surface), history: [], causes: [] };
}
function inheritSurface(source: DomainSnapshot, target: Grid, input: AtlasGenerationInput) {
  const world = source.world;
  const available = world.fields.filter(
    (f) =>
      f.spaceId === target.scope.spaceId &&
      !(input.domains.includes("physical") && f.areaId === input.areaId) &&
      source.numerical[f.id] &&
      spatial.covers(source.numerical[f.id].scope.footprint, target.scope.footprint)
  );
  for (const field of available) {
    const grid = source.numerical[field.id];
    for (const name of Object.keys(grid.channels))
      resample(grid, target, name, grid.units[name] === "category");
  }
  requireThat(
    input.domains.includes("physical") ||
      target.channels.elevation ||
      world.areas[input.areaId].profile === "interior",
    "generation_prerequisite",
    "Generate physical geography first, or include it in this request."
  );
}
function initialFacts(surface: Grid) {
  const facts = new Set(Object.keys(surface.channels));
  if (surface.channels.bedrock) facts.add("geology");
  if (surface.channels.receiver) facts.add("drainage");
  return facts;
}
function invoke(process: MapProcess, id = process.contract.id) {
  return {
    kind: "process" as const,
    id,
    process: process.contract.id,
    version: process.contract.version,
  };
}
function weather(magic: boolean): ProcessSequence {
  return [
    invoke(resetForcingProcess),
    ...(magic ? [invoke(thermalMagicProcess)] : []),
    invoke(temperatureProcess),
    invoke(precipitationProcess),
    ...(magic ? [invoke(materialMagicProcess)] : []),
  ];
}
export function atlasConfiguration(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): ProcessConfiguration {
  const sequence: ProcessSequence = [invoke(prepareGeneratedProcess(input.domains))];
  const area = source.world.areas[input.areaId],
    physical = input.domains.includes("physical");
  const magic = input.domains.includes("magic") || source.world.magic.length > 0;
  if (area.profile !== "interior" && (physical || input.domains.includes("magic"))) {
    sequence.push(invoke(initializeTerrainProcess));
    if (physical)
      sequence.push({
        kind: "epochs",
        id: "physical-history",
        resetFacts: [],
        epochs: source.world.epochs.map((epoch) => ({
          id: epoch.id,
          duration: 1000,
          parentEpoch: epoch.id,
          variables: {
            temperature: epoch.temperature,
            seaLevel: epoch.seaLevel,
            activity: epoch.tectonics,
          },
        })),
        body: [
          invoke(tectonicsProcess),
          ...weather(magic),
          invoke(iceBalanceProcess),
          invoke(drainageProcess),
          invoke(erosionProcess),
          ...(magic ? [invoke(magicStorageProcess)] : []),
        ],
      });
    sequence.push(...weather(magic), invoke(drainageProcess), invoke(extractGeographyProcess));
  }
  if (input.domains.includes("cultural")) sequence.push(invoke(culturalProcess));
  if (input.domains.includes("political")) sequence.push(invoke(politicalProcess));
  if (input.domains.includes("built")) sequence.push(invoke(builtProcess));
  requireThat(
    sequence.length > 1,
    "profile_domains",
    "Choose a generation domain supported by this profile."
  );
  return { id: `atlas:${area.profile}`, version: 1, parameters: {}, sequence };
}
