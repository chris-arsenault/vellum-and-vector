import type { GenerationState } from "../process";
import type { PhysicalArrayName } from "./continuousState";
import { Landform as L } from "./codes";
import { units, truncate } from "./math";
import { spatial } from "@atlas/domain";
import {
  all,
  any,
  not,
  above,
  below,
  physicalScalar,
  sumScalar,
  regionShape,
  regionReader,
  type CausalRegion,
} from "./causalRegions";
import { riverRegion } from "./riverRegions";

export function waterRegions(state: GenerationState): Record<number, CausalRegion> {
  const bodies = state.surface.geography?.water?.lakes ?? [];
  const lakes = regionShape(
    bodies.length ? spatial.unionAll(bodies.map((lake) => lake.footprint)) : null
  );
  const ocean = all(regionShape(state.surface.ocean ?? null), not(lakes));
  return { 0: not(any(ocean, lakes)), 1: ocean, 2: lakes };
}

/** The same ordered causal inequalities supply point labels and geographic regions. */
export function landformRegions(state: GenerationState) {
  const p = state.physical!.profile,
    water = waterRegions(state);
  const reads = new Map<PhysicalArrayName, ReturnType<typeof physicalScalar>>();
  const field = (name: PhysicalArrayName) => {
    if (!reads.has(name)) reads.set(name, physicalScalar(state, name));
    return reads.get(name)!;
  };
  const ge = (name: PhysicalArrayName, value: number) => above(field(name), value);
  const gt = (name: PhysicalArrayName, value: number) => above(field(name), value, false);
  const le = (name: PhysicalArrayName, value: number) => below(field(name), value);
  const river = regionShape(riverRegion(state, (order) => order > 0));
  const glaciated = all(
    le("GlacialFormationDepth", 0),
    ge("MaximumGroundedIceFlux", p.GlacierFluxThreshold)
  );
  const moraine = all(glaciated, gt("CumulativeDeposition", 0));
  const cirque = all(
    glaciated,
    not(moraine),
    ge("MaximumIceThickness", p.GlacierThicknessThreshold),
    ge("GlacialHeadRelief", 0)
  );
  const valley = all(
    glaciated,
    not(any(moraine, cirque)),
    gt("CumulativeGlacialErosion", 0),
    any(river, ge("FlowAccumulation", truncate(p.RiverAccumulationThreshold / 2)))
  );
  const rules: [number, CausalRegion][] = [
    [
      L.Fjord,
      all(
        water[1],
        any(valley, cirque, ge("CumulativeGlacialErosion", units(p.FjordMinimumGlacialErosion)))
      ),
    ],
    [L.Seabed, water[1]],
    [L.Moraine, moraine],
    [L.Cirque, cirque],
    [L.UValley, valley],
    [L.Basin, water[2]],
    [
      L.ImpactRim,
      all(
        ge("ImpactRimUplift", units(p.ImpactLandformMinimumRimUplift)),
        above(
          sumScalar([
            [field("ImpactRimUplift"), 2],
            [field("ImpactExcavation"), -1],
          ]),
          0,
          false
        )
      ),
    ],
    [
      L.ImpactBasin,
      all(
        ge("ImpactExcavation", units(p.ImpactLandformMinimumExcavation)),
        ge("LandformHigher", 2)
      ),
    ],
    [
      L.OutwashPlain,
      all(
        ge("CumulativeGlacialDeposition", units(p.OutwashMinimumGlacialDeposition)),
        le("Slope", p.PlainSlopeThreshold)
      ),
    ],
    [L.Waterfall, all(river, ge("WaterfallDrop", units(p.WaterfallMinimumDrop)))],
    [
      L.Gorge,
      all(
        river,
        ge("Slope", p.GorgeMinimumSlope),
        ge("CumulativeFluvialErosion", units(p.GorgeMinimumIncision))
      ),
    ],
    [
      L.Peak,
      all(
        ge("Elevation", units(p.PeakElevationThreshold)),
        ge("LandformLower", 2),
        ge("LandformProminence", units(p.PeakProminenceThreshold))
      ),
    ],
    [
      L.Pass,
      all(
        ge("Elevation", units(p.RidgeElevationThreshold)),
        ge("RidgeInfluence", Math.fround(0.34)),
        ge("LandformHigher", 2),
        ge("LandformLower", 1)
      ),
    ],
    [
      L.Ridge,
      all(
        ge("Elevation", units(p.RidgeElevationThreshold)),
        ge("Slope", p.RidgeSlopeThreshold),
        any(
          ge("RidgeInfluence", Math.fround(0.26)),
          ge("Uplift", Math.fround(0.42)),
          ge("TectonicActivityHistory", p.InheritedRidgeActivityThreshold)
        )
      ),
    ],
    [
      L.Valley,
      any(
        river,
        ge("CumulativeFluvialErosion", units(p.AncestralValleyMinimumErosion)),
        all(
          ge("LandformHigher", 2),
          gt("Slope", p.PlainSlopeThreshold),
          ge("FlowAccumulation", truncate(p.RiverAccumulationThreshold / 3))
        )
      ),
    ],
    [L.Plain, le("Slope", p.PlainSlopeThreshold)],
    [L.Slope, true],
  ];
  // Both consumers apply first-match precedence. Embedding the preceding
  // rules here repeats their contouring and Boolean subtraction for each class.
  return new Map(rules);
}
export function landformField(state: GenerationState) {
  const regions = [...landformRegions(state)].map(
    ([code, region]) => [code, regionReader(region)] as const
  );
  return (x: number, y: number) => regions.find(([, read]) => read(x, y))?.[0] ?? 0;
}
export function waterKindField(state: GenerationState) {
  const regions = waterRegions(state),
    ocean = regionReader(regions[1]),
    lakes = regionReader(regions[2]);
  return (x: number, y: number) => (lakes(x, y) ? 2 : Number(ocean(x, y)));
}
