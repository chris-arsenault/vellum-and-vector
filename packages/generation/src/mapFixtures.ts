import {
  createGrid,
  putChannel,
  rectangle,
  type Area,
  type DomainSnapshot,
  type ParameterValues,
  type SpatialScope,
  type World,
} from "@atlas/domain";
import {
  iceBalanceProcess,
  precipitationProcess,
  resetForcingProcess,
  temperatureProcess,
} from "./mapClimate";
import { magicStorageProcess, thermalMagicProcess } from "./mapMagic";
import {
  MapProcessRegistry,
  type GenerationEpoch,
  type GenerationState,
  type MapProcess,
  type ProcessConfiguration,
  type ProcessInvocation,
  type ProcessSequence,
} from "./process";

function rootArea(scope: SpatialScope): Area {
  return {
    id: "area",
    name: "Mountain coast",
    context: "landscape",
    parentId: null,
    profile: "world",
    footprint: scope.footprint,
    frame: { origin: { x: 0, y: 0, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
    spaceId: "surface",
    version: 1,
    traits: [],
    layers: {},
    boundary: null,
    templateId: null,
  };
}

export function landscape(): GenerationState {
  const footprint = rectangle([0, 0, 4000, 1000]),
    scope = {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      footprint,
      crsId: "metres",
      revision: 1,
      time: "present",
      resolution: 1000,
    },
    world: World = {
      id: "world",
      name: "Mountain coast",
      seed: 42,
      version: 1,
      owner: "creator",
      reference: {
        id: "metres",
        domain: footprint,
        topology: "planar",
        units: "metre",
        axes: "east,north,up",
        verticalDatum: "sea",
        precision: 1e-6,
      },
      areas: { area: rootArea(scope) },
      features: {},
      fields: [],
      entities: {},
      templates: {},
      magic: [],
      landmarks: [],
      epochs: [],
      generations: [],
      views: [],
      layers: {
        physical: {
          id: "physical",
          name: "Physical fields",
          family: "physical",
          representation: "field",
          color: "#ffffff",
          profiles: ["world", "region"],
          schema: {},
          generator: null,
          facts: ["elevation", "temperature", "ice", "heat", "precipitation"],
        },
      },
    },
    domain: DomainSnapshot = {
      world,
      scope,
      revisions: [],
      resources: [],
      numerical: {},
      identities: {},
      coverage: [],
      fieldPatches: [],
    },
    surface = createGrid("landscape", scope, 5, 2);
  putChannel(
    surface,
    "elevation",
    "metre",
    Float64Array.from({ length: 10 }, (_v, i) => [-10, 100, 1100, 100, 100][i % 5])
  );
  return { domain, surface, facts: new Set(["elevation"]), history: [] };
}

export function source(overrides: Partial<World["magic"][number]> = {}): World["magic"][number] {
  return {
    id: "thermal-core",
    name: "Thermal core",
    source: { x: 2000, y: 0, z: 0 },
    radius: 10000,
    strength: 4,
    propagation: "radial",
    effect: "heat",
    decay: 0,
    storage: 0.5,
    dependsOn: null,
    startsAtEpoch: 0,
    spaceId: "surface",
    ...overrides,
  };
}
export function invoke(
  process: MapProcess,
  id = process.contract.id,
  parameters?: ParameterValues
): ProcessInvocation {
  return {
    kind: "process",
    id,
    process: process.contract.id,
    version: process.contract.version,
    ...(parameters ? { parameters } : {}),
  };
}
export function epoch(
  id: string,
  duration: number,
  variables: ParameterValues = {}
): GenerationEpoch {
  return { id, duration, parentEpoch: null, variables };
}
export function configuration(
  sequence: ProcessSequence,
  parameters: ParameterValues = {}
): ProcessConfiguration {
  return { id: "mountain-coast", version: 1, parameters, sequence };
}
export function registry(...extra: MapProcess[]) {
  return [
    resetForcingProcess,
    temperatureProcess,
    precipitationProcess,
    iceBalanceProcess,
    thermalMagicProcess,
    magicStorageProcess,
    ...extra,
  ].reduce((result, process) => result.register(process), new MapProcessRegistry());
}
export const options = { seed: "42", seedScope: "mountain-coast" };
