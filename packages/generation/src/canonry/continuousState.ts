import {
  prepareSampleCoefficients,
  preparedSampleInterpolator,
  type SampleCoefficients,
  type SampleSupport,
  prepareAdaptiveCoefficients,
  preparedAdaptiveInterpolator,
  type PreparedAdaptiveCoefficients,
} from "@atlas/domain";
import { continuousScalarNames, type PhysicalField } from "./field";
import { physicalSupport } from "./physicalSupport";
import { environment } from "./ecologyEnvironment";
import { updateDerivedFields } from "./derivedFields";
import { provinceBinding } from "./motionPublication";

export type PhysicalArrayName = {
  [K in keyof PhysicalField]-?: PhysicalField[K] extends ArrayLike<number> ? K : never;
}[keyof PhysicalField];
export interface ContinuousPhysicalState {
  geography?: NonNullable<import("@atlas/domain").Grid["geography"]>;
  ocean?: import("geojson").Geometry | null;
  support: SampleSupport;
  coefficients: Partial<Record<PhysicalArrayName, SampleCoefficients>>;
  adaptive: Partial<Record<PhysicalArrayName, PreparedAdaptiveCoefficients>>;
}
const scalarNames = new Set<PhysicalArrayName>(continuousScalarNames);
const pathInputs = new Set<PhysicalArrayName>([
  "Elevation",
  "DrainageElevations",
  "FlowTargets",
  "RiverOrders",
  "FlowAccumulation",
  "WaterKindCodes",
  "WaterSurfaceElevations",
]);
const environmentInputs = new Set<PhysicalArrayName>([
  "Temperature",
  "Rainfall",
  "Snowfall",
  "Slope",
  "DrainageElevations",
  "Elevation",
  "FloodplainIntensity",
  "DeltaIntensity",
  "WaterKindCodes",
  "WaterDepths",
]);

/** Commit derivatives of the same nodal arrays mutated by the causal operation. */
export function preparePhysicalChannels(map: PhysicalField, names: Iterable<PhysicalArrayName>) {
  const support = physicalSupport(map.mesh);
  if (map.continuous?.support !== support) {
    map.continuous = { support, coefficients: {}, adaptive: {} };
    names = scalarNames;
  }
  const changed = new Set(names);
  if ([...changed].some((name) => pathInputs.has(name))) {
    map.riverPaths = null;
  }
  if (changed.size) {
    delete map.continuous.geography;
    delete map.continuous.ocean;
  }
  updateDerivedFields(map, changed);
  if ([...changed].some((name) => environmentInputs.has(name))) {
    for (let i = 0; i < map.mesh.count; i++) {
      const e = environment(map, i);
      map.EcologicalMoisture[i] = e.moisture;
      map.EcologicalWetness[i] = e.wetness;
    }
    changed.add("EcologicalMoisture");
    changed.add("EcologicalWetness");
  }
  for (const name of changed) {
    if (!scalarNames.has(name)) continue;
    if (
      ["CrustMotionX", "CrustMotionY"].includes(name) &&
      provinceBinding(map, name === "CrustMotionX" ? "crustMotionX" : "crustMotionY")
    ) {
      delete map.continuous.coefficients[name];
      delete map.continuous.adaptive[name];
      continue;
    }
    if (map.mesh.topology) {
      const next = prepareAdaptiveCoefficients(
        map.mesh.topology,
        (leaf) => map[name][map.mesh.leafToCell[leaf]]
      );
      const previous = map.continuous.adaptive[name];
      if (previous) previous.cells = next.cells;
      else map.continuous.adaptive[name] = next;
    } else {
      const next = prepareSampleCoefficients(support, map[name]);
      const previous = map.continuous.coefficients[name];
      if (previous) {
        previous.dx.set(next.dx);
        previous.dy.set(next.dy);
        previous.affine = next.affine;
      } else map.continuous.coefficients[name] = next;
    }
  }
}

/** Reads cannot repair missing producer work. Coordinates are local mesh metres. */
export function physicalFieldReader(map: PhysicalField, name: PhysicalArrayName) {
  const adaptive = map.continuous?.adaptive[name];
  if (adaptive) {
    const at = preparedAdaptiveInterpolator(adaptive);
    return (x: number, y: number) => at(x + map.mesh.origin[0], y + map.mesh.origin[1]);
  }
  const source = map.continuous,
    coefficients = source?.coefficients[name];
  if (!source || !coefficients)
    throw new Error(`Prepare ${name} in its generation process before reading its field.`);
  const at = preparedSampleInterpolator(source.support, map[name], coefficients);
  return (x: number, y: number) => at(x + map.mesh.origin[0], y + map.mesh.origin[1]);
}
