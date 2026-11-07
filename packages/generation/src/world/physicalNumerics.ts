import { blockShift, type Band, type SampleType } from "@atlas/domain";
import type { PhysicalField } from "./field";

/** Process-owned numerical work; retained physical channels are allocated by createField. */
export function workingArray(
  map: PhysicalField,
  type: SampleType,
  name: string,
  length = map.mesh.count
) {
  return map.coverage.scratch(type, name, length);
}
export function workingValues(
  map: PhysicalField,
  type: SampleType,
  name: string,
  value: (i: number) => number,
  length = map.mesh.count
) {
  const band = map.coverage.scratch(type, name, length);
  for (let block = 0; block < band.blockCount; block++) {
    const values = band.block(block, true),
      start = block << blockShift;
    for (let n = 0; n < values.length; n++) values[n] = value(start + n);
    band.unpin(block);
  }
  return band;
}
export function releaseWorking(map: PhysicalField, ...bands: Band[]) {
  for (const band of bands) map.coverage.release(band);
}
/** Causal state survives process cleanup and is reclaimed when the runner replaces it. */
export function retainedArray(
  map: PhysicalField,
  type: SampleType,
  name: string,
  length = map.mesh.count
) {
  const band = map.coverage.scratch(type, name, length);
  band.retain();
  return band;
}
