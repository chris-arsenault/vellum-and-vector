// TectonicMarginLayer.cs and TectonicEpochLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round } from "./math";
import { hashUnit } from "./noise";
import { metricSearch } from "./metricSearch";
import { tectonicOceanMaturityMyr } from "./tectonicControls";
import { workingArray, releaseWorking } from "./physicalNumerics";
import type { NumericalVector } from "@atlas/domain";

const unreachable = 2147483647;
function expand(
  map: PhysicalField,
  queue: Iterable<number>,
  distance: NumericalVector,
  kind: NumericalVector | null,
  reach: number
) {
  metricSearch(
    map.mesh,
    queue,
    distance,
    reach,
    (j, i) => {
      if (kind) kind[j] = kind[i];
    },
    map.numerical
  );
}
export function tectonicMargins(map: PhysicalField, context: PhysicalContext) {
  const count = map.mesh.count,
    p = context.Profile;
  const distance = workingArray(map, "float64", "margin:distance").fill(unreachable),
    spreading = workingArray(map, "float64", "margin:spreading").fill(unreachable);
  const kind = workingArray(map, "int32", "margin:kind");
  for (let i = 0; i < count; i++) {
    const code = map.TectonicBoundaryCodes[i];
    if (code === 0) continue;
    distance[i] = 0;
    kind[i] = code;
    if (code === 2) {
      spreading[i] = 0;
    }
  }
  function* seeds(spreadingOnly: boolean) {
    for (let i = 0; i < count; i++)
      if (spreadingOnly ? map.TectonicBoundaryCodes[i] === 2 : map.TectonicBoundaryCodes[i] !== 0)
        yield i;
  }
  expand(map, seeds(false), distance, kind, Math.max(1, p.MarginInfluenceReach));
  expand(map, seeds(true), spreading, null, unreachable);
  assignMarginsAndAge(map, context, kind, spreading);
  releaseWorking(map, distance, spreading, kind);
}
function assignMarginsAndAge(
  map: PhysicalField,
  context: PhysicalContext,
  kind: NumericalVector,
  spreading: NumericalVector
) {
  const p = context.Profile;
  let oldest = 0;
  for (const value of spreading) if (value !== unreachable) oldest = Math.max(oldest, value);
  const scale = Math.max(1, Math.min(oldest, p.CrustAgeSaturationDistance));
  const increment = Math.max(
    1,
    round((context.TectonicDurationMyr * 1000) / tectonicOceanMaturityMyr)
  );
  for (let i = 0; i < map.mesh.count; i++) {
    map.MarginCodes[i] =
      kind[i] === 1
        ? 2
        : kind[i] === 2
          ? 3
          : kind[i] === 3
            ? 4
            : map.CrustTypeCodes[i] === 2
              ? 1
              : 0;
    ageTriangle(map, context, i, spreading[i], scale, increment);
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
    map.CrustAge[i] = round(
      Math.sqrt(distance === unreachable ? 1 : clamp(distance / scale, 0, 1)) * 1000
    );
  else if (map.AdvectionSourceIndex[i] < 0) map.CrustAge[i] = 0;
  else if (map.CrustContinentalFraction[i] < 500)
    map.CrustAge[i] = Math.min(1000, map.CrustAge[i] + increment);
}
export function tectonicEpoch(map: PhysicalField, context: PhysicalContext) {
  if (!context.IsEvolutionEpoch)
    throw new Error("Tectonic epoch activity requires an evolution epoch.");
  const persistence = context.Profile.TectonicBoundaryPersistence / 1000;
  for (let i = 0; i < map.mesh.count; i++) {
    const code = map.InitialTectonicBoundaryCodes[i],
      strain = map.InitialTectonicStrain[i];
    if (code === 0 || strain === 0) {
      map.TectonicBoundaryCodes[i] = 0;
      map.TectonicStrain[i] = 0;
      continue;
    }
    const pairActivity = hashUnit(context.Seed ^ 0x58d7, map.TectonicBoundaryPairIds[i], code);
    map.TectonicBoundaryCodes[i] = code;
    map.TectonicStrain[i] = round(
      clamp(strain * (persistence + (1 - persistence) * pairActivity), 0, 1000)
    );
  }
}
