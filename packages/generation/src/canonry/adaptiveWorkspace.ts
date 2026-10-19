import {
  adaptiveLeafAt,
  refineAdaptiveWhere,
  prepareAdaptiveTransfer,
  visitAdaptiveOverlap,
  type AdaptiveTopology,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { remeshPhysical } from "./physicalRemesh";
import { refreshWorkspaceProtection, refreshWorkspaceSamples } from "./atlasWorkspace";
import type { PhysicalContext } from "./context";
import { plannedImpacts } from "./impacts";
import { plumeCenter } from "./volcanism";
import type { PhysicalMesh } from "./mesh";
import { refreshGrounding } from "./glacierSurface";

export interface SamplingSupport {
  x: number;
  y: number;
  radius: number;
  size: number;
}
function supported([x0, y0, x1, y1]: number[], supports: SamplingSupport[]) {
  return supports.some(
    ({ x, y, radius, size }) =>
      Math.max(x1 - x0, y1 - y0) > size &&
      Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) <= radius
  );
}
function supportBins(topology: AdaptiveTopology, supports: SamplingSupport[]) {
  const bins = new Map<number, SamplingSupport[]>();
  for (const s of supports)
    visitAdaptiveOverlap(
      topology,
      [s.x - s.radius, s.y - s.radius, s.x + s.radius, s.y + s.radius],
      (leaf) => {
        if (!bins.has(leaf)) bins.set(leaf, []);
        bins.get(leaf)!.push(s);
      }
    );
  return (box: number[]) =>
    bins.get(adaptiveLeafAt(topology, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2)) ?? [];
}
function remapArray(
  old: PhysicalMesh,
  mesh: PhysicalMesh,
  values: ArrayLike<number>,
  quantity: "category" | "intensive" | "extensive",
  transfer: ReturnType<typeof prepareAdaptiveTransfer>
) {
  const source = new Float64Array(old.count);
  for (let leaf = 0; leaf < source.length; leaf++) source[leaf] = values[old.leafToCell[leaf]];
  const next = transfer(source, quantity);
  const result = new Float64Array(mesh.count);
  for (let cell = 0; cell < result.length; cell++) result[cell] = next[mesh.cellToLeaf[cell]];
  return result;
}
function remapMagic(
  state: GenerationState,
  old: PhysicalMesh,
  transfer: ReturnType<typeof prepareAdaptiveTransfer>
) {
  const work = state.physical!,
    magic = work.magic;
  if (!magic) return;
  for (const field of magic.fields) {
    for (const [key, value] of Object.entries(field)) {
      if (!(value instanceof Float64Array)) continue;
      Object.assign(field, {
        [key]: remapArray(
          old,
          work.map.mesh,
          value,
          key.endsWith("Epoch") ? "category" : key === "retained" ? "extensive" : "intensive",
          transfer
        ),
      });
    }
    for (const [key, values] of Object.entries(field.features))
      field.features[key] = Uint8Array.from(
        remapArray(old, work.map.mesh, values, "category", transfer)
      );
  }
  for (const key of ["heat", "coastal", "naturalSurface", "finalSurface"] as const)
    magic[key] = remapArray(
      old,
      work.map.mesh,
      magic[key],
      key.endsWith("Surface") ? "category" : "intensive",
      transfer
    );
}
/** Refinement precedes construction or an already scheduled global reconciliation. */
export function refineWorkspace(state: GenerationState, supports: SamplingSupport[]) {
  const work = state.physical!,
    old = work.map.mesh;
  if (!old.topology || !supports.length) return false;
  const started = performance.now();
  const candidates = supportBins(old.topology, supports);
  const minimum = supports.reduce((size, support) => Math.min(size, support.size), Infinity);
  const topology = refineAdaptiveWhere(old.topology, minimum, (box) =>
    supported(box, candidates(box))
  );
  if (topology === old.topology) return false;
  const assembled = performance.now();
  const transfer = prepareAdaptiveTransfer(old.topology, topology);
  work.map = remeshPhysical(work.map, topology, state.domain.scope.footprint, transfer);
  refreshGrounding(work.map, work.profile);
  for (const fact of [
    "FlowRouting",
    "DrainageConditioning",
    "DrainageGuidance",
    "AtmosphericFlow",
    "IceFlow",
    "Rivers",
    "RiverGeometry",
    "Floodplains",
    "Deltas",
    "GlacialMeltwater",
    "Validated",
  ]) {
    work.map.AvailableFacts.delete(fact);
    state.facts.delete(`canonry:${fact}`);
  }
  remapMagic(state, old, transfer);
  refreshWorkspaceSamples(state, work, transfer);
  refreshWorkspaceProtection(state, work);
  console.log("Adaptive terrain refinement", {
    from: old.count,
    to: work.map.mesh.count,
    topologySeconds: (assembled - started) / 1000,
    transferSeconds: (performance.now() - assembled) / 1000,
  });
  return true;
}
export function refineGeologicalCauses(
  state: GenerationState,
  context: PhysicalContext,
  name: string
) {
  const work = state.physical!,
    mesh = work.map.mesh,
    p = context.Profile;
  const samples = work.sampling.featureSamples;
  const supports: SamplingSupport[] = [];
  if (name === "impact-cratering")
    for (const event of plannedImpacts(work.map, context))
      supports.push({
        x: event.x + mesh.origin[0],
        y: event.y + mesh.origin[1],
        radius: event.radius * 2.2,
        size: event.radius / (samples * 2),
      });
  if (name === "volcanic-construction" && (p.VolcanicConeHeight > 0 || p.VolcanicApronHeight > 0))
    for (const root of work.map.events.filter((e) => e.kind === "plume")) {
      const [x, y] = plumeCenter(
        context,
        root,
        context.IsEvolutionEpoch ? context.EpochIndex + 1 : 0
      );
      supports.push({
        x: x + mesh.origin[0],
        y: y + mesh.origin[1],
        radius: p.VolcanicConeRadius,
        size: p.VolcanicConeRadius / samples,
      });
      supports.push({
        x: x + mesh.origin[0],
        y: y + mesh.origin[1],
        radius: p.VolcanicConeRadius * 0.28,
        size: (p.VolcanicConeRadius * 0.28) / samples,
      });
    }
  refineWorkspace(state, supports);
}
