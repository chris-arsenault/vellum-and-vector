import type { SampleSupport } from "@atlas/domain";
import type { PhysicalMesh } from "./mesh";

const supports = new WeakMap<PhysicalMesh, SampleSupport>();
export function physicalSupport(mesh: PhysicalMesh): SampleSupport {
  let support = supports.get(mesh);
  if (!support) {
    support = {
      x: Float64Array.from(mesh.x),
      y: Float64Array.from(mesh.y),
      origin: mesh.origin,
      spacing: mesh.spacing,
    };
    supports.set(mesh, support);
  }
  return support;
}
