import {
  biomeCode,
  biomes,
  spatial,
  biomeFieldInterpolator,
  sampledFieldContour,
  fieldContour,
  geometryParts,
  type BiomeFieldRule,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { ecologicalSupport } from "./ecologicalSupport";
import { nativePosition } from "./atlasWorkspace";
import type { GenerationState } from "../process";
import { publishPlace } from "./geographicRegions";
import { polygonRegion } from "./causalRegions";

/** Located woodland and wetland regions use the same spatial publication as landforms. */
export function extractEcologicalFeatures(state: GenerationState) {
  const map = state.physical!.map;
  const source = state.surface.geography;
  if (!source?.biome || !state.surface.mesh)
    throw new Error("Prepare and publish ecological fields before extracting their regions.");
  const prepared = source.categories?.biome;
  if (!prepared) throw new Error("Classify ecological geography before feature extraction.");
  const regions = new Map(prepared.entries.map((entry) => [entry.code, entry.footprint]));
  const kinds = [
    ["Barren", "barren"],
    ["Desert", "desert"],
    ["Tundra", "tundra"],
    ["Grassland", "grassland"],
    ["Savanna", "savanna"],
    ["Woodland", "forest"],
    ["Temperate forest", "forest"],
    ["Boreal forest", "forest"],
    ["Rainforest", "forest"],
    ["Marsh", "marsh"],
    ["Swamp", "swamp"],
    ["Altered woodland", "forest"],
    ["Altered wetland", "swamp"],
  ] as const;
  for (const [name, kind] of kinds) {
    const code = biomeCode(name);
    const publish = (members: number[], geometry?: Geometry, component = 0) => {
      if (!geometry) return;
      const extent = geometry;
      if (source?.biome && !source.biome.codes.includes(code)) source.biome.codes.push(code);
      const area = members.reduce((sum, i) => sum + map.mesh.areas[i], 0);
      const average = (values: Float64Array) =>
        members.reduce((sum, i) => sum + values[i] * map.mesh.areas[i], 0) / area;
      publishPlace(
        state,
        kind,
        name,
        members,
        "ecology",
        {
          sourceAlgorithm: "atlas-ecology-1",
          biome: biomes[code].name,
          treeCover: average(map.TreeCover),
          broadleafCover: average(map.BroadleafCover),
          coniferCover: average(map.ConiferCover),
          alteredCover: average(map.AlteredCover),
          canopyAge: average(map.CanopyAge),
          wetlandCover: average(map.WetlandCover),
          herbivores: average(map.Herbivores),
          peatCarbon: average(map.PeatCarbon),
        },
        extent,
        `${code}:${component}`
      );
    };
    publishRegions(state, regions.get(code) ?? null, publish);
  }
}
/** Producer classification; extraction only consumes these completed regions. */
export function prepareEcologicalRegions(state: GenerationState) {
  const source = state.surface.geography!;
  if (!source.biome) throw new Error("Prepare ecological fields before classification.");
  source.biome.lakes = source.water?.lakes ?? [];
  const regions = partitionRegions(
    state,
    biomeFieldInterpolator(
      state.physical!.map.continuous!.support,
      source.biome,
      state.surface.ocean
    ).partition
  );
  (source.categories ??= {}).biome = {
    fallback: 0,
    entries: [...regions].map(([code, footprint]) => ({ code, footprint })),
  };
  source.biome.codes = [...regions.keys()];
  return regions;
}
export function partitionRegions(state: GenerationState, root: BiomeFieldRule) {
  const mesh = state.physical!.map.mesh,
    members = Array.from({ length: mesh.contentCount }, (_, i) => i),
    parts = new Map<number, Geometry[]>();
  const visit = (rule: BiomeFieldRule, region: Geometry) => {
    if (typeof rule === "number") {
      const regions = parts.get(rule) ?? [];
      regions.push(region);
      parts.set(rule, regions);
      return;
    }
    // Trace primitive thresholds before composing decision branches. In
    // particular, trees=.15 and trees=.4 retain the woodland between them.
    const bounds = spatial.bounds(region),
      halo = mesh.spacing;
    const local = members.filter(
      (i) =>
        mesh.x[i] + mesh.origin[0] >= bounds[0] - halo &&
        mesh.x[i] + mesh.origin[0] <= bounds[2] + halo &&
        mesh.y[i] + mesh.origin[1] >= bounds[1] - halo &&
        mesh.y[i] + mesh.origin[1] <= bounds[3] + halo
    );
    const positive = traceRegion(mesh, local, region, rule);
    const yes = polygonRegion(positive && spatial.intersection(region, positive)),
      no = polygonRegion(positive ? spatial.difference(region, positive) : region);
    if (yes) visit(rule.yes, yes);
    if (no) visit(rule.no, no);
  };
  visit(root, state.domain.scope.footprint);
  return new Map(
    [...parts].map(([code, regions]) => [
      code,
      regions.length === 1 ? regions[0] : spatial.unionAll(regions),
    ])
  );
}
function traceRegion(
  mesh: import("./mesh").PhysicalMesh,
  local: number[],
  region: Geometry,
  rule: Exclude<BiomeFieldRule, number>
) {
  let positive = rule.region;
  if (positive === undefined) {
    if (mesh.topology) {
      positive = fieldContour(
        mesh.topology,
        rule.test,
        undefined,
        0,
        10,
        rule.enclose,
        rule.segment,
        region
      );
      return positive && rule.exclude ? spatial.difference(positive, rule.exclude) : positive;
    }
    const support = ecologicalSupport(mesh, local, region);
    positive = sampledFieldContour(
      support.triangles,
      rule.test,
      0,
      support.boundary,
      10,
      rule.enclose,
      rule.segment
    );
  }
  return positive && rule.exclude ? spatial.difference(positive, rule.exclude) : positive;
}
function publishRegions(
  state: GenerationState,
  shape: Geometry | null,
  publish: (members: number[], geometry?: Geometry, component?: number) => void
) {
  const map = state.physical!.map;
  const members = Array.from({ length: map.mesh.contentCount }, (_, i) => i);
  if (!members.length) return;
  if (!shape) return;
  const occurrences = new Map<number, number>();
  const publishComponent = (owned: number[], part: Geometry) => {
    const representative = owned.reduce((a, b) => (map.Elevation[a] >= map.Elevation[b] ? a : b)),
      occurrence = occurrences.get(representative) ?? 0;
    occurrences.set(representative, occurrence + 1);
    publish(owned, part, occurrence);
  };
  const parts = geometryParts(shape).sort((a, b) => {
    const aa = spatial.bounds(a),
      bb = spatial.bounds(b);
    for (let i = 0; i < 4; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return 0;
  });
  for (const part of parts) {
    if (part.type !== "Polygon") continue;
    const covers = spatial.pointCoverage(part);
    const owned = members.filter((i) => covers(nativePosition(state.physical!, i)));
    if (owned.length) publishComponent(owned, part);
    else {
      const p = spatial.interiorPosition(part);
      const nearest = members.reduce((a, b) => {
        const distance = (i: number) =>
          Math.hypot(
            map.mesh.x[i] + map.mesh.origin[0] - p.x,
            map.mesh.y[i] + map.mesh.origin[1] - p.y
          );
        return distance(a) <= distance(b) ? a : b;
      });
      publishComponent([nearest], part);
    }
  }
}
