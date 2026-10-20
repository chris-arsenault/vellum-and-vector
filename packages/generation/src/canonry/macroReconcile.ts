import { spatial } from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "../process";
import { nativeContext } from "./context";
import { oceanDistance, bathymetry, landmasses } from "./geography";
import { landformClassification } from "./landforms";
import { refreshGrounding } from "./glacierSurface";
import { Feature } from "./codes";
import { macroComponents, reconstructRegion } from "./macroRegions";
import { membershipContour } from "./geographicContours";
import {
  addTerrainProfile,
  bakeFinishedTerrain,
  finishedElevation,
  profileElevation,
} from "./macroTerrain";
import { reconcileFinishedWater } from "./macroWater";
import { classifyNaturalSurface } from "./naturalSurface";
import { magicMatcher, paintMagicFeatures } from "./magicFeatures";
import type { MagicField } from "./magicState";
import { composeNativeAuthoring } from "./atlasWorkspace";

export function fitReefSubstrate(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    mesh = map.mesh;
  for (const cells of macroComponents(
    mesh,
    (i) => map.ReefCover[i] > 0.5 && map.WaterKindCodes[i] === 1
  )) {
    const includes = new Set(cells),
      footprint = membershipContour(state, cells, (i) => Number(includes.has(i)));
    if (!footprint) continue;
    const bounds = spatial.bounds(footprint),
      point: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    addTerrainProfile(work, {
      id: `reef-substrate:${cells[0]}`,
      points: [point],
      widths: [Math.max(1, Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]))],
      values: {
        elevation: [profileElevation(work, map.EffectiveSeaLevel) - 100],
        physicalMaterial: [8],
      },
      footprint,
      edgeBlend: 5000,
      plateau: true,
      operation: "raise",
    });
  }
}
function composeCurrents(state: GenerationState) {
  const map = state.physical!.map,
    original = Uint8Array.from(map.OceanCurrentStrength, (v, i) =>
      Number(v >= 560 && map.WaterKindCodes[i] === 1)
    ),
    region = reconstructRegion(
      map.mesh,
      original,
      (i) => map.WaterKindCodes[i] === 1 && map.IceThickness[i] < 2,
      35_000
    );
  for (let i = 0; i < map.mesh.count; i++) {
    const source = region.source[i];
    if (!region.mask[i] || original[i] || source < 0) continue;
    for (const key of [
      "OceanCurrentX",
      "OceanCurrentY",
      "OceanCurrentStrength",
      "OceanCurrentHeat",
    ] as const)
      map[key][i] = (map[key][i] + map[key][source]) / 2;
  }
}
function reconcileEcologicalMagic(state: GenerationState, seed: number) {
  const work = state.physical!;
  for (const field of work.magic?.fields ?? [])
    for (const rule of field.definition.features) reconcileMagicRule(state, field, rule, seed);
}
function reconcileMagicRule(
  state: GenerationState,
  field: MagicField,
  rule: MagicField["definition"]["features"][number],
  seed: number
) {
  const ecological = [...rule.seeds, ...(rule.retains ?? [])]
    .flat()
    .some((test) =>
      [
        "biome",
        "treeCover",
        "wetlandCover",
        "peatCarbon",
        "oilCarbon",
        "alteredCover",
        "ecologicalAlteration",
        "ecologicalToxicity",
        "soilWater",
        "soilDepth",
        "grazers",
        "browsers",
      ].includes(test.field)
    );
  if (!ecological || !field.features[rule.id]) return;
  const retains = magicMatcher(state, field, rule.retains ?? rule.seeds, seed),
    seeds = magicMatcher(state, field, rule.seeds, seed),
    mask = field.features[rule.id];
  for (let i = 0; i < mask.length; i++)
    mask[i] = Number(seeds(i) || Boolean(mask[i] && retains(i)));
}
/** Recompute present derivatives; no epoch erosion, transport or growth runs here. */
export function reconcileMacroLandscape(
  state: GenerationState,
  context: MapProcessContext,
  seed: number
) {
  const work = state.physical!,
    map = work.map,
    physical = nativeContext(state, context, seed, 0);
  const before = work.finishing!.profiles.length;
  fitReefSubstrate(state);
  if (work.finishing!.profiles.length !== before) bakeFinishedTerrain(work);
  reconcileFinishedWater(work);
  oceanDistance(map);
  const slope = map.Slope.slice();
  bathymetry(map, physical);
  map.Slope.set(slope);
  landmasses(map, physical);
  landformClassification(map, physical, finishedElevation(work));
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.IceThickness[i] < 50)
      map.FeatureFlags[i] &= ~(Feature.PermanentSeaIce | Feature.PermanentIceMargin);
  }
  refreshGrounding(map, work.profile);
  composeCurrents(state);
  classifyNaturalSurface(state);
  reconcileEcologicalMagic(state, seed);
  if (work.magic) paintMagicFeatures(state);
  composeNativeAuthoring(work);
  refreshGrounding(map, work.profile);
}
