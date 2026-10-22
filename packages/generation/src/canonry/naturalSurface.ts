import {
  biomes,
  naturalSurfaceNames,
  surfaceCode,
  putChannel,
  spatial,
  categoryRegions,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalArrayName } from "./continuousState";
import { Landform as L } from "./codes";
import {
  all,
  any,
  not,
  above,
  below,
  physicalScalar,
  regionShape,
  regionTracer,
  type CausalRegion,
} from "./causalRegions";
import { prepareCategory, sampleCategory, categoryRegion } from "./categoryGeography";
import { landformRegions, waterRegions } from "./landformField";
import { oceanFootprint } from "./geographicContours";
import { extractLakes } from "./geographicRegions";
import { projectEcologySupport } from "./ecologyPublication";
import { prepareEcologicalRegions } from "./ecologyFeatures";

/** Complete causal category geography before publication or feature extraction. */
export function classifyNaturalSurface(state: GenerationState) {
  const work = state.physical!,
    { map, profile: p } = work;
  const source = (state.surface.geography ??= {});
  source.categories = {};
  state.surface.ocean = oceanFootprint(state);
  const lakes = extractLakes(state, false);
  source.water = {
    elevation: map.Elevation,
    bodyIds: map.WaterBodyIds,
    coefficients: map.continuous!.coefficients.Elevation,
    adaptive: map.continuous!.adaptive.Elevation,
    transform: { scale: 1 / 1024, offset: -map.BaseSeaLevel / 1024 },
    seaLevel: (map.EffectiveSeaLevel - map.BaseSeaLevel) / 1024,
    lakes,
  };
  putChannel(state.surface, "biome", "category", map.BiomeCodes, "category");
  projectEcologySupport(work, state.surface);
  source.biome!.lakes = lakes;
  const trace = regionTracer(state);
  putChannel(state.surface, "landform", "category", map.LandformCodes, "category");
  prepareCategory(state, "landform", [...landformRegions(state)], L.Slope, trace);
  sampleCategory(state, "landform", map.LandformCodes);
  const biomeRegions = prepareEcologicalRegions(state);
  sampleCategory(state, "biome", map.BiomeCodes);

  const fields = new Map<PhysicalArrayName, ReturnType<typeof physicalScalar>>();
  const field = (name: PhysicalArrayName) => {
    if (!fields.has(name)) fields.set(name, physicalScalar(state, name));
    return fields.get(name)!;
  };
  const ge = (name: PhysicalArrayName, level: number) => above(field(name), level);
  const gt = (name: PhysicalArrayName, level: number) => above(field(name), level, false);
  const le = (name: PhysicalArrayName, level: number) => below(field(name), level);
  const landformShapes = categoryRegions(state.surface, "landform");
  const landform = (...codes: number[]) =>
    regionShape(categoryRegion(state, "landform", (code) => codes.includes(code), landformShapes));
  const water = waterRegions(state),
    ocean = water[1],
    land = not(ocean);
  const shallow = ge("Elevation", map.EffectiveSeaLevel - p.ShelfBreakDepth * 1024);
  const formedIce = all(
    ge("SeaIceSuitability", 1000 - p.SeaIceFormationTemperature),
    le("Temperature", p.IceMarginTemperature)
  );
  const frozen = trace(all(ocean, gt("IceThickness", 0)));
  // Polynya proximity is a physical sea-ice length, independent of sampling density.
  const nearIce = regionShape(frozen ? spatial.buffer(frozen, p.SeaIceVariationScale) : null);
  const exposedShelf = all(
    le("Elevation", map.EffectiveSeaLevel + p.ShelfDepth * 512),
    ge("OceanDistance", 0),
    le("OceanDistance", 180_000)
  );
  const rules: [(typeof naturalSurfaceNames)[number], CausalRegion][] = [
    ["Delta", gt("DeltaIntensity", 0)],
    ["Fjord", all(ocean, landform(L.Fjord))],
    [
      "Reef",
      all(
        ocean,
        shallow,
        ge("Elevation", map.EffectiveSeaLevel - 160 * 1024),
        any(ge("Temperature", 260), ge("OceanCurrentHeat", 420)),
        ge("Geothermal", 60)
      ),
    ],
    ["Ice shelf", all(ocean, shallow, ge("IceThickness", 75))],
    ["Pack ice", all(ocean, formedIce, le("Temperature", p.PermanentSeaIceTemperature))],
    ["Sea ice", all(ocean, any(formedIce, ge("IceThickness", 50)))],
    ["Polynya", all(ocean, nearIce)],
    [
      "Trench",
      all(
        ocean,
        not(shallow),
        ge("TectonicStrain", 430),
        any(
          above(field("TectonicNormalMotion"), p.TectonicConvergenceThreshold, false),
          below(field("TectonicNormalMotion"), -p.TectonicConvergenceThreshold, false)
        )
      ),
    ],
    ["Current channel", all(ocean, ge("OceanCurrentStrength", 560))],
    ["Shelf", all(ocean, shallow)],
    ["Ocean", ocean],
    ["Waterfall", landform(L.Waterfall)],
    ["Gorge", landform(L.Gorge)],
    ["River channel", gt("RiverChannelStrength", 0)],
    ["Floodplain", gt("FloodplainIntensity", 0)],
    ["Lake", water[2]],
    ["Exposed shelf", all(land, exposedShelf)],
    ["Moraine", landform(L.Moraine)],
    ["Glacier", ge("IceThickness", 300)],
    ["Snowfield", ge("IceThickness", 250)],
    ["River valley", landform(L.Valley, L.UValley)],
    ["Scree field", ge("Slope", 0.0235)],
    ["Ridge", landform(L.Ridge, L.Peak, L.Pass, L.ImpactRim)],
  ];
  for (const [code, shape] of biomeRegions) {
    const name = biomes[code]?.name;
    if (naturalSurfaceNames.includes(name as (typeof naturalSurfaceNames)[number]))
      rules.push([name as (typeof naturalSurfaceNames)[number], regionShape(shape)]);
  }
  rules.push(
    ["Open field", all(ge("Temperature", 335), ge("Moisture", 260))],
    ["Wet tundra", ge("Moisture", 620)],
    ["Polar barrens", all(le("Temperature", 255), le("Moisture", 210))],
    [
      "Cold steppe",
      all(ge("Temperature", 235), ge("Moisture", 150), le("Moisture", 520), le("Slope", 0.0042)),
    ]
  );
  prepareCategory(
    state,
    "naturalSurface",
    rules.map(([name, condition]) => [surfaceCode(name), condition]),
    surfaceCode("Tundra"),
    trace
  );
  putChannel(state.surface, "naturalSurface", "category", map.NaturalSurfaceCodes, "category");
  sampleCategory(state, "naturalSurface", map.NaturalSurfaceCodes);
  map.FinalSurfaceCodes.set(map.NaturalSurfaceCodes);
  source.categories.finalSurface = source.categories.naturalSurface;
  putChannel(state.surface, "finalSurface", "category", map.FinalSurfaceCodes, "category");
  const material: [number, CausalRegion][] = [
    [7, all(ocean, not(shallow))],
    [
      8,
      all(
        ocean,
        ge("Elevation", map.EffectiveSeaLevel - 125 * 1024),
        ge("Temperature", 300),
        ge("Geothermal", 150)
      ),
    ],
    [6, ocean],
    [3, any(gt("DeltaIntensity", 0), gt("FloodplainIntensity", 0))],
    [10, landform(L.Moraine)],
    [9, ge("Geothermal", 760)],
    [5, ge("IceThickness", 300)],
    [0, landform(L.Gorge, L.Waterfall)],
    [0, all(landform(L.Peak, L.Ridge), ge("Slope", 0.0085))],
    [1, landform(L.Peak, L.Ridge)],
    [4, all(le("Temperature", 250), ge("Moisture", 560))],
    [2, le("Temperature", 250)],
    [3, ge("Moisture", 330)],
  ];
  prepareCategory(state, "physicalMaterial", material, 2, trace);
  const materialValues = new Float64Array(map.mesh.count);
  putChannel(state.surface, "physicalMaterial", "category", materialValues, "category");
  sampleCategory(state, "physicalMaterial", materialValues);
  map.continuous!.geography = source;
  map.continuous!.ocean = state.surface.ocean;
}
