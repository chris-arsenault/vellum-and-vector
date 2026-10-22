import type { FieldSamples } from "./grids";
import type { SampleSupport } from "./smoothSamples";
import type { Position } from "./model";
import { sampleStations } from "./smoothSamples";
import { adaptiveLeafAt } from "./adaptiveTopology";

export interface FieldMesh extends SampleSupport {
  adaptive?: { topology: import("./adaptiveTopology").AdaptiveTopology; leafToSample: Int32Array };
  offsets: Int32Array;
  neighbors: Int32Array;
  cellBounds: Float64Array;
}
/** The process mesh is numerical support for a prepared field, not a display lattice. */
export interface SampledGrid extends FieldSamples {
  mesh: FieldMesh;
  width?: never;
  height?: never;
  topology?: never;
}
export function nearestFieldSample(
  mesh: SampleSupport & Pick<Partial<FieldMesh>, "adaptive">,
  p: Position
) {
  if (mesh.adaptive) {
    const leaf = adaptiveLeafAt(mesh.adaptive.topology, p.x, p.y);
    return leaf < 0 ? -1 : mesh.adaptive.leafToSample[leaf];
  }
  const stations = sampleStations(mesh)(p.x, p.y);
  let nearest = -1,
    distance = Infinity;
  for (const s of stations) {
    const squared = s.dx * s.dx + s.dy * s.dy;
    if (squared < distance) {
      nearest = s.i;
      distance = squared;
    }
  }
  return nearest;
}
