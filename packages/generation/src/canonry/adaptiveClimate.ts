import { meshDeltaX } from "./mesh";
import type { GenerationState, MapProcess } from "../process";
import type { PhysicalContext } from "./context";
import { refineWorkspace, remeshInvalidations, type SamplingSupport } from "./adaptiveWorkspace";
import { nativeContext } from "./context";
import { physicalFace, physicalDistance } from "./physicalMetric";
import { physicalFeatureSequence } from "../physicalFeatureSequence";
import type { ResolvedFeatures } from "../features";

export function shoreSupport(state: GenerationState, context: PhysicalContext) {
  const work = state.physical!,
    map = work.map,
    mesh = map.mesh;
  const size = work.profile.LandformNeighborhoodRadius / work.sampling.featureSamples;
  const level = map.BaseSeaLevel + context.SeaLevelOffset * 1024;
  const supports: SamplingSupport[] = [];
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < i || map.Elevation.get(i) < level === map.Elevation.get(j) < level) continue;
      if (
        Math.max(mesh.cellWidth(i), mesh.cellHeight(i), mesh.cellWidth(j), mesh.cellHeight(j)) <=
        size
      )
        continue;
      const face = physicalFace(mesh, i, edge),
        stations = Math.max(1, Math.ceil(face.length / size));
      for (let n = 0; n <= stations; n++) {
        const along = face.length * (n / stations - 0.5);
        supports.push({
          x: face.x - face.ny * along + mesh.origin[0],
          y: face.y + face.nx * along + mesh.origin[1],
          radius: size,
          size,
        });
      }
    }
  return supports;
}
export function adaptiveClimateProcess(): MapProcess {
  return {
    contract: {
      id: "canonry.refine-climate",
      version: "0f62584c",
      parameters: {},
      requires: ["canonry:Elevation"],
      produces: [],
      invalidates: [],
      reconciliation: { invalidates: remeshInvalidations, sequence: [], guarantees: [] },
      workspaceOnly: true,
    },
    behavior: {
      kind: "transfer",
      async transfer(state, context) {
        const c = nativeContext(state, context, 0);
        if (refineWorkspace(state, shoreSupport(state, c), "declared")) await context.reconcile!();
      },
    },
    validate: () => [],
  };
}

function iceSupport(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    mesh = map.mesh,
    p = work.profile;
  const size = p.LandformNeighborhoodRadius / work.sampling.featureSamples;
  const supports: SamplingSupport[] = [];
  for (let i = 0; i < mesh.count; i++) {
    const j = map.IceFlowTargets.get(i);
    if (j < 0 || !map.GroundedIce.get(i) || map.IceFlux.get(i) < p.GlacierFluxThreshold) continue;
    if (
      Math.max(mesh.cellWidth(i), mesh.cellHeight(i), mesh.cellWidth(j), mesh.cellHeight(j)) <= size
    )
      continue;
    const stations = Math.max(1, Math.ceil(physicalDistance(mesh, i, j) / size)),
      xi = mesh.x(i),
      yi = mesh.y(i),
      dx = meshDeltaX(mesh, mesh.x(j) - xi),
      dy = mesh.y(j) - yi;
    for (let n = 0; n <= stations; n++)
      supports.push({
        x: xi + mesh.origin[0] + (dx * n) / stations,
        y: yi + mesh.origin[1] + (dy * n) / stations,
        radius: size,
        size,
      });
  }
  return supports;
}
export function adaptiveIceProcess(features: ResolvedFeatures): MapProcess {
  return {
    contract: {
      id: "canonry.refine-ice",
      version: "0f62584c",
      parameters: {},
      requires: ["canonry:IceFlow"],
      produces: [],
      invalidates: [],
      reconciliation: {
        invalidates: [...remeshInvalidations, "canonry:Landforms"],
        sequence: physicalFeatureSequence("ice.flow", features),
        guarantees: ["canonry:IceFlow"],
      },
      workspaceOnly: true,
    },
    behavior: {
      kind: "transfer",
      async transfer(state, context) {
        if (!refineWorkspace(state, iceSupport(state), "declared")) return;
        // Thickness has already accumulated for this pass. Transfer its volume,
        // then rebuild the routing diagnostic without adding another growth step.
        await context.reconcile!();
      },
    },
    validate: () => [],
  };
}
