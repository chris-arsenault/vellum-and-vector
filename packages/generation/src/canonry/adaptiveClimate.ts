import type { GenerationState, MapProcess } from "../process";
import type { PhysicalContext } from "./context";
import { refineWorkspace, type SamplingSupport } from "./adaptiveWorkspace";
import { nativeContext } from "./context";
import { physicalFace, physicalDistance } from "./physicalMetric";
import { applyNativeStep } from "./contracts";
import { iceFlow } from "./iceFlow";

export function shoreSupport(state: GenerationState, context: PhysicalContext) {
  const work = state.physical!,
    map = work.map,
    mesh = map.mesh;
  const size = work.profile.LandformNeighborhoodRadius / work.sampling.featureSamples;
  const level = map.BaseSeaLevel + context.SeaLevelOffset * 1024;
  const supports: SamplingSupport[] = [];
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (j < i || map.Elevation[i] < level === map.Elevation[j] < level) continue;
      if (
        Math.max(mesh.cellWidth[i], mesh.cellHeight[i], mesh.cellWidth[j], mesh.cellHeight[j]) <=
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
export function adaptiveClimateProcess(seed: number): MapProcess {
  return {
    contract: {
      id: "canonry.refine-climate",
      version: "0f62584c",
      parameters: {},
      requires: ["canonry:Elevation"],
      produces: [],
      invalidates: [],
      workspaceOnly: true,
    },
    apply(state, context) {
      const c = nativeContext(state, context, seed, 0);
      refineWorkspace(state, shoreSupport(state, c));
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
    const j = map.IceFlowTargets[i];
    if (j < 0 || !map.GroundedIce[i] || map.IceFlux[i] < p.GlacierFluxThreshold) continue;
    if (
      Math.max(mesh.cellWidth[i], mesh.cellHeight[i], mesh.cellWidth[j], mesh.cellHeight[j]) <= size
    )
      continue;
    const stations = Math.max(1, Math.ceil(physicalDistance(mesh, i, j) / size));
    for (let n = 0; n <= stations; n++)
      supports.push({
        x: mesh.x[i] + mesh.origin[0] + ((mesh.x[j] - mesh.x[i]) * n) / stations,
        y: mesh.y[i] + mesh.origin[1] + ((mesh.y[j] - mesh.y[i]) * n) / stations,
        radius: size,
        size,
      });
  }
  return supports;
}
export function adaptiveIceProcess(seed: number): MapProcess {
  return {
    contract: {
      id: "canonry.refine-ice",
      version: "0f62584c",
      parameters: {},
      requires: ["canonry:IceFlow"],
      produces: ["canonry:IceFlow"],
      invalidates: ["canonry:Landforms", "canonry:GlacialMeltwater"],
      workspaceOnly: true,
    },
    apply(state, context) {
      if (!refineWorkspace(state, iceSupport(state))) return;
      // Thickness has already accumulated for this pass. Transfer its volume,
      // then rebuild the routing diagnostic without adding another growth step.
      const c = nativeContext(state, context, seed, 0);
      applyNativeStep(state.physical!.map, c, ["ice-flow", 0, iceFlow]);
      state.facts.add("canonry:IceFlow");
    },
    validate: () => [],
  };
}
