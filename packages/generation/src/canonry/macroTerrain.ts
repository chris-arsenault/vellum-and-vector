import {
  fieldInterpolator,
  type Grid,
  type GridSurface,
} from "@atlas/domain";
import { projectedValues } from "./atlasSampling";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { physicalSampler } from "./physicalMetric";
import { rebuild } from "./surface";
import type { RiverPaths } from "./riverPaths";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { authoredFields } from "../mapAuthored";
import { landscapeInterpolator, landscapeSlope, type LandscapeProfile } from "./landscapeProfiles";

export interface LandscapeFinishing {
  baseElevation: Float64Array;
  profiles: LandscapeProfile[];
  baseSurface?: Grid;
  passes: { id: string; cells: number[]; profile: LandscapeProfile }[];
  events: Map<string, { footprint: Geometry; caldera?: Geometry }>;
  lakes: Map<number, { footprint: Geometry; level: number }>;
  ocean?: Geometry | null;
  rivers?: RiverPaths;
  exclusions?: Record<string, Geometry[]>;
  protectedCells?: Uint8Array;
  drops: { id: string; cell: number; point: [number, number]; drop: number }[];
  summits: [number, number][];
  field?: GridSurface;
}
export function beginFinishing(work: AtlasPhysicalWorkspace, surface?: Grid): LandscapeFinishing {
  const finishing: LandscapeFinishing = {
    baseElevation: work.map.Elevation.slice(),
    profiles: [],
    passes: [],
    events: new Map(),
    lakes: new Map(),
    drops: [],
    summits: [],
  };
  if (surface)
    finishing.baseSurface = {
      ...surface,
      channels: {
        elevation: projectedValues(work, work.map.Elevation).map((value) =>
          profileElevation(work, value)
        ),
        bedrock: projectedValues(work, work.map.BedrockElevation).map((value) => profileElevation(work, value)),
      },
      units: { elevation: "metre", bedrock: "metre" },
      quantities: { elevation: "intensive", bedrock: "intensive" },
    };
  work.finishing = finishing;
  return finishing;
}
export function finishedElevation(work: AtlasPhysicalWorkspace) {
  if (work.finishing?.field) {
    const read = fieldInterpolator(work.finishing.field, "elevation");
    return (x: number, y: number) => read({x: x + work.map.mesh.origin[0], y: y + work.map.mesh.origin[1], z: 0}) * 1024 + work.map.BaseSeaLevel;
  }
  const map = work.map,
    finishing = work.finishing,
    native = physicalSampler(map.mesh, finishing?.baseElevation ?? map.Elevation);
  const source = finishing?.baseSurface,
    base = source
      ? fieldInterpolator(source, "elevation")
      : (p: { x: number; y: number }) =>
          (native(p.x - map.mesh.origin[0], p.y - map.mesh.origin[1]) - map.BaseSeaLevel) / 1024;
  const valueAt = landscapeInterpolator(finishing?.profiles, "elevation", base);
  return (x: number, y: number) =>
    valueAt({ x: x + map.mesh.origin[0], y: y + map.mesh.origin[1], z: 0 }) * 1024 +
    map.BaseSeaLevel;
}

/** Commit composed relief to the coarse working state without changing epoch histories. */
export function bakeFinishedTerrain(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    elevation = finishedElevation(work);
  for (let i = 0; i < map.mesh.count; i++) {
    const originalHeight = map.Elevation[i];
    const previous = Math.max(0, map.Elevation[i] - map.EffectiveSeaLevel);
    map.Elevation[i] = elevation(map.mesh.x[i], map.mesh.y[i]);
    const changed = Math.max(0, map.Elevation[i] - map.EffectiveSeaLevel) - previous;
    map.Temperature[i] = Math.max(
      0,
      Math.min(
        1000,
        map.Temperature[i] -
          ((changed / 1024) * work.profile.ElevationTemperatureLapse) / work.profile.ElevationScale
      )
    );
    map.BedrockElevation[i] = map.Elevation[i] - map.SedimentThickness[i];
    rebuild(map, i);
    if (!map.WaterKindCodes[i]) map.DrainageElevations[i] += map.Elevation[i] - originalHeight;
  }
  const height = (p: { x: number; y: number; z: number }) => elevation(p.x, p.y) / 1024;
  for (let i = 0; i < map.mesh.count; i++)
    map.Slope[i] = landscapeSlope(height, { x: map.mesh.x[i], y: map.mesh.y[i], z: 0 });
}
export function addTerrainProfile(work: AtlasPhysicalWorkspace, profile: LandscapeProfile) {
  if (!work.finishing) throw new Error("Begin macro composition before adding terrain profiles.");
  const exclusions = { ...work.finishing.exclusions };
  for (const [name, shapes] of Object.entries(profile.exclusions ?? {}))
    exclusions[name] = [...(exclusions[name] ?? []), ...shapes];
  work.finishing.profiles = [...work.finishing.profiles, { ...profile, exclusions }];
}
export function profileElevation(work: AtlasPhysicalWorkspace, nativeHeight: number) {
  return (nativeHeight - work.map.BaseSeaLevel) / 1024;
}
export function fixedTerrain(work: AtlasPhysicalWorkspace, i: number) {
  return (
    Boolean(work.finishing?.protectedCells?.[i]) ||
    work.fixed.some(
      ({ binding, values }) => binding.native === "Elevation" && Number.isFinite(values[i])
    )
  );
}

/** Exact authored footprints constrain profiles as well as their sampled centres. */
export function protectFinishing(state: GenerationState) {
  const work = state.physical!,
    finishing = work.finishing!,
    exclusions: Record<string, Geometry[]> = {};
  for (const authority of authoredFields(state.domain)) {
    if (
      !authority.source ||
      (authority.spaceId && authority.spaceId !== state.domain.scope.spaceId)
    )
      continue;
    const shape = authority.footprint ?? authority.source.scope.footprint;
    for (const name of authority.channels ?? Object.keys(authority.source.channels)) {
      excludeAuthored(exclusions, name, shape);
    }
  }
  finishing.exclusions = exclusions;
  finishing.protectedCells = Uint8Array.from(work.map.mesh.x, (_, i) =>
    Number(work.fixed.some(({ values }) => Number.isFinite(values[i])))
  );
}
function excludeAuthored(exclusions: Record<string, Geometry[]>, name: string, shape: Geometry) {
  (exclusions[name] ??= []).push(shape);
  if (["bedrock", "waterDepth", "waterLevel"].includes(name))
    (exclusions.elevation ??= []).push(shape);
}
