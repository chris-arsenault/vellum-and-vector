import { surfaceCode } from "@atlas/domain";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { reconstructRegion } from "./macroRegions";
import { classifyBiome } from "./ecologyEnvironment";
import { extendCommunities } from "./macroCommunities";
import { fixedTerrain } from "./macroTerrain";

export function composeReefs(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    surface = work.magic?.naturalSurface;
  if (!surface) return new Uint8Array(map.mesh.count);
  const original = Uint8Array.from(surface, (value) => Number(value === surfaceCode("Reef"))),
    suitable = (i: number) =>
      map.WaterKindCodes[i] === 1 &&
      map.WaterDepths[i] < 180 * 1024 &&
      map.IceThickness[i] < 1 &&
      map.Temperature[i] >= 180;
  const region = reconstructRegion(map.mesh, original, suitable, 45_000, (i) => map.WaterKindCodes[i] === 1);
  for (let i = 0; i < region.mask.length; i++) {
    map.ReefCover[i] = region.mask[i];
    if (region.mask[i]) surface[i] = surfaceCode("Reef");
    else if (original[i]) surface[i] = surfaceCode("Ocean");
  }
  return region.mask;
}

export function composeBiologicalRegions(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    land = (i: number) =>
      !map.WaterKindCodes[i] && map.IceThickness[i] < 1 && !fixedTerrain(work, i);
  const forest = Uint8Array.from(map.TreeCover, (value, i) => Number(value >= 0.4 && land(i))),
    wetland = Uint8Array.from(map.WetlandCover, (value, i) => Number(value >= 0.25 && land(i)));
  const woods = reconstructRegion(
    map.mesh,
    forest,
    (i) => land(i) && map.SoilDepth[i] >= 0.15 && map.Moisture[i] >= 250,
    35_000
  );
  extendCommunities(work, forest, woods.mask, woods.source);
  const marsh = reconstructRegion(
    map.mesh,
    wetland,
    (i) =>
      land(i) &&
      map.Slope[i] < 0.01 &&
      (map.FloodplainIntensity[i] > 0 || map.SoilWater[i] >= 0.15),
    20_000
  );
  extendCommunities(work, wetland, marsh.mask, marsh.source);
  composeCommunityMosaics(work, land);
  for (let i = 0; i < map.mesh.count; i++) map.BiomeCodes[i] = classifyBiome(map, i);
}
function composeCommunityMosaics(work: AtlasPhysicalWorkspace, land: (i: number) => boolean) {
  const map = work.map;
  const regions: [ArrayLike<number>, number, number, (i: number) => boolean][] = [
    [
      map.AlteredCover,
      0.2,
      30_000,
      (i) => map.SoilDepth[i] > 0.06 && map.Temperature[i] + map.ColdAdaptation[i] * 10 > 200,
    ],
    [
      map.GrassCover,
      0.4,
      25_000,
      (i) => map.Moisture[i] > 100 && map.Temperature[i] > 280 && map.Slope[i] < 0.05,
    ],
    [map.ConiferCover, 0.4, 25_000, (i) => map.Temperature[i] < 450 && map.Moisture[i] > 200],
    [map.FireActivity, 0.25, 15_000, (i) => map.TreeCover[i] + map.GrassCover[i] > 0.1],
    [map.EcologicalDamage, 0.25, 15_000, (i) => map.SoilDepth[i] > 0],
  ];
  for (const [values, threshold, radius, suitable] of regions) {
    const original = Uint8Array.from(values, (value, i) => Number(value >= threshold && land(i))),
      region = reconstructRegion(map.mesh, original, (i) => land(i) && suitable(i), radius);
    extendCommunities(work, original, region.mask, region.source);
  }
  // Empty climatic regions remain empty; closing their small intrusions moves
  // existing communities rather than creating vegetation on unseeded land.
  for (const climate of [
    (i: number) => map.Temperature[i] < 320,
    (i: number) => map.Moisture[i] < 250,
  ]) {
    const original = Uint8Array.from(map.TreeCover, (value, i) =>
        Number(land(i) && climate(i) && value + map.GrassCover[i] < 0.12)
      ),
      region = reconstructRegion(map.mesh, original, (i) => land(i) && climate(i), 20_000);
    extendCommunities(work, original, region.mask, region.source);
  }
}
