// TectonicMarginLayer.cs and TectonicEpochLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round } from "./math";
import { hashUnit } from "./noise";
import { metricSearch } from "./metricSearch";
import { tectonicOceanMaturityMyr } from "./tectonicControls";
import { workingArray, releaseWorking } from "./physicalNumerics";
import type { Band } from "@atlas/domain";

const unreachable = 2147483647;
function expand(
  map: PhysicalField,
  queue: Iterable<number>,
  distance: Band,
  kind: Band | null,
  reach: number
) {
  metricSearch(map.mesh, queue, distance, reach, (j, i) => {
    if (kind) kind.set(j, kind.get(i));
  });
}
export function tectonicMargins(map: PhysicalField, context: PhysicalContext) {
  const count = map.mesh.count,
    p = context.Profile;
  const distance = workingArray(map, "float64", "margin:distance").fill(unreachable),
    spreading = workingArray(map, "float64", "margin:spreading").fill(unreachable);
  const kind = workingArray(map, "int32", "margin:kind");
  for (let i = 0; i < count; i++) {
    const code = map.TectonicBoundaryCodes.get(i);
    if (code === 0) continue;
    distance.set(i, 0);
    kind.set(i, code);
    if (code === 2) spreading.set(i, 0);
  }
  function* seeds(spreadingOnly: boolean) {
    for (let i = 0; i < count; i++) {
      const code = map.TectonicBoundaryCodes.get(i);
      if (spreadingOnly ? code === 2 : code !== 0) yield i;
    }
  }
  expand(map, seeds(false), distance, kind, Math.max(1, p.MarginInfluenceReach));
  expand(map, seeds(true), spreading, null, unreachable);
  assignMarginsAndAge(map, context, kind, spreading);
  releaseWorking(map, distance, spreading, kind);
}
function assignMarginsAndAge(
  map: PhysicalField,
  context: PhysicalContext,
  kind: Band,
  spreading: Band
) {
  const p = context.Profile;
  const oldest = map.coverage.reduce(
    spreading,
    (held, value) => (value !== unreachable ? Math.max(held, value) : held),
    0
  );
  const scale = Math.max(1, Math.min(oldest, p.CrustAgeSaturationDistance));
  const increment = Math.max(
    1,
    round((context.TectonicDurationMyr * 1000) / tectonicOceanMaturityMyr)
  );
  for (let i = 0; i < map.mesh.count; i++) {
    const code = kind.get(i);
    map.MarginCodes.set(
      i,
      code === 1 ? 2 : code === 2 ? 3 : code === 3 ? 4 : map.CrustTypeCodes.get(i) === 2 ? 1 : 0
    );
    ageTriangle(map, context, i, spreading.get(i), scale, increment);
  }
}
function ageTriangle(
  map: PhysicalField,
  context: PhysicalContext,
  i: number,
  distance: number,
  scale: number,
  increment: number
) {
  if (!context.IsEvolutionEpoch)
    map.CrustAge.set(
      i,
      round(Math.sqrt(distance === unreachable ? 1 : clamp(distance / scale, 0, 1)) * 1000)
    );
  else if (map.AdvectionSourceIndex.get(i) < 0) map.CrustAge.set(i, 0);
  else if (map.CrustContinentalFraction.get(i) < 500)
    map.CrustAge.set(i, Math.min(1000, map.CrustAge.get(i) + increment));
}
export function tectonicEpoch(map: PhysicalField, context: PhysicalContext) {
  if (!context.IsEvolutionEpoch)
    throw new Error("Tectonic epoch activity requires an evolution epoch.");
  const persistence = context.Profile.TectonicBoundaryPersistence / 1000;
  for (let i = 0; i < map.mesh.count; i++) {
    const code = map.InitialTectonicBoundaryCodes.get(i),
      strain = map.InitialTectonicStrain.get(i);
    if (code === 0 || strain === 0) {
      map.TectonicBoundaryCodes.set(i, 0);
      map.TectonicStrain.set(i, 0);
      continue;
    }
    const pairActivity = hashUnit(context.Seed ^ 0x58d7, map.TectonicBoundaryPairIds.get(i), code);
    map.TectonicBoundaryCodes.set(i, code);
    map.TectonicStrain.set(
      i,
      round(clamp(strain * (persistence + (1 - persistence) * pairActivity), 0, 1000))
    );
  }
}
