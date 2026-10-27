import {
  allocateNumerical,
  generateNumerical,
  type SampleType,
  type NumericalVector,
} from "@atlas/domain";
import type { PhysicalField } from "./field";

/** Process-owned numerical work; retained physical channels are allocated by createField. */
export function workingArray(
  map: PhysicalField,
  type: SampleType,
  name: string,
  length = map.mesh.count
) {
  return allocateNumerical({ type, length, lifetime: "process", name }, map.numerical);
}
export function workingValues(
  map: PhysicalField,
  type: SampleType,
  name: string,
  value: (i: number) => number,
  length = map.mesh.count
) {
  return generateNumerical({ type, length, lifetime: "process", name }, value, map.numerical);
}
export function releaseWorking(map: PhysicalField, ...vectors: NumericalVector[]) {
  map.numerical?.releaseUnused(vectors, []);
}
/** Causal state survives process cleanup and is reclaimed when the runner replaces it. */
export function retainedArray(
  map: PhysicalField,
  type: SampleType,
  name: string,
  length = map.mesh.count
) {
  return allocateNumerical({ type, length, lifetime: "run", name }, map.numerical);
}
