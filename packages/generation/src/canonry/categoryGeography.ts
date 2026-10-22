import { fieldInterpolator, spatial, categoryRegions, type Grid } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { nativePosition } from "./atlasWorkspace";
import { regionTracer, polygonRegion, type CausalRegion } from "./causalRegions";

export type CategoryGeography = NonNullable<NonNullable<Grid["geography"]>["categories"]>[string];
/** Classification produces geography; arrays are samples for numerical processes. */
export function prepareCategory(
  state: GenerationState,
  name: string,
  rules: [number, CausalRegion][],
  fallback: number,
  trace = regionTracer(state)
): CategoryGeography {
  let remaining: Geometry | null = state.domain.scope.footprint;
  const entries: CategoryGeography["entries"] = [];
  for (const [code, rule] of rules) {
    if (!remaining) break;
    const shape = trace(rule, remaining);
    const footprint = polygonRegion(shape && spatial.intersection(remaining, shape));
    if (!footprint) continue;
    entries.push({ code, footprint });
    remaining = polygonRegion(spatial.difference(remaining, footprint));
  }
  const result = { fallback, entries };
  ((state.surface.geography ??= {}).categories ??= {})[name] = result;
  return result;
}
export function sampleCategory(
  state: GenerationState,
  name: string,
  target: { length: number; [index: number]: number }
) {
  const read = fieldInterpolator(state.surface, name, true);
  for (let i = 0; i < target.length; i++) target[i] = read(nativePosition(state.physical!, i));
}
export function categoryRegion(
  state: GenerationState,
  name: string,
  includes: (code: number) => boolean,
  regions?: Map<number, Geometry>
): Geometry | null {
  if (!state.surface.geography?.categories?.[name])
    throw new Error(`Prepare ${name} geography before classification.`);
  const entries = [...(regions ?? categoryRegions(state.surface, name))]
    .filter(([code]) => includes(code))
    .map(([, shape]) => shape);
  return entries.length === 1 ? entries[0] : entries.length ? spatial.unionAll(entries) : null;
}
