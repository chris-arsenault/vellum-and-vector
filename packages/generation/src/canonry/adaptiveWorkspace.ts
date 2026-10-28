import {
  refineAdaptiveWhere,
  prepareAdaptiveTransfer,
  type Band,
  type NumericalAllocator,
  type SampleType,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { remeshPhysical } from "./physicalRemesh";
import { refreshWorkspaceProtection, refreshWorkspaceSamples } from "./atlasWorkspace";
import type { PhysicalContext } from "./context";
import { plannedImpacts } from "./impacts";
import { plumeCenter } from "./volcanism";
import type { PhysicalMesh } from "./mesh";
import { physicalBands, type PhysicalField } from "./field";
import { refreshGrounding } from "./glacierSurface";
import { retainedArray } from "./physicalNumerics";
import { invalidateNativeProducts } from "../productLedger";
import {
  magicChannels,
  magicFieldDefinitions,
  magicWorkspaceChannels,
  magicWorkspaceDefinitions,
} from "./magicFieldDefinitions";

export interface SamplingSupport {
  x: number;
  y: number;
  radius: number;
  size: number;
}
/** These diagnostics contain cell/edge indices or depend on reset routing arrays. */
export const remeshInvalidations = [
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
  "Lakes",
  "LakeOutlets",
  "Validated",
].map((product) => `canonry:${product}`);
export type RemeshInvalidationPolicy = "standalone" | "declared";
function supported([x0, y0, x1, y1]: number[], supports: SamplingSupport[]) {
  return supports.some(
    ({ x, y, radius, size }) =>
      Math.max(x1 - x0, y1 - y0) > size &&
      Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) <= radius
  );
}
/** Carry one band from the old lattice onto the new one; the old band is released. */
function remapBand(
  old: PhysicalMesh,
  map: PhysicalField,
  values: Band,
  quantity: "category" | "intensive" | "extensive",
  transfer: ReturnType<typeof prepareAdaptiveTransfer>,
  numerical?: NumericalAllocator,
  type: SampleType = "float64"
) {
  // The transfer works on adaptive leaves in the surface arena; the result is a new band.
  const leaves = transfer((leaf) => values.get(old.leafToCell(leaf)), quantity);
  const result = retainedArray(map, type, values.name);
  for (let cell = 0; cell < map.mesh.count; cell++)
    result.set(cell, leaves[map.mesh.cellToLeaf(cell)]);
  if (numerical) numerical.release(leaves);
  return result;
}
function remapMagic(
  state: GenerationState,
  old: PhysicalField,
  transfer: ReturnType<typeof prepareAdaptiveTransfer>
) {
  const work = state.physical!,
    magic = work.magic;
  if (!magic) return;
  const carry = (
    values: Band,
    quantity: "category" | "intensive" | "extensive",
    type: SampleType = "float64"
  ) => {
    const next = remapBand(old.mesh, work.map, values, quantity, transfer, state.numerical, type);
    old.coverage.release(values);
    return next;
  };
  for (const field of magic.fields) {
    delete field.parents;
    for (const key of magicChannels)
      field[key] = carry(field[key], magicFieldDefinitions[key].quantity);
    for (const [key, values] of Object.entries(field.features))
      field.features[key] = carry(values, "category", "uint8");
  }
  for (const key of magicWorkspaceChannels)
    magic[key] = carry(magic[key], magicWorkspaceDefinitions[key].quantity);
}
/** Refinement precedes construction or an already scheduled global reconciliation. */
export function refineWorkspace(
  state: GenerationState,
  supports: SamplingSupport[],
  invalidation: RemeshInvalidationPolicy = "standalone"
) {
  const work = state.physical!,
    previous = work.map,
    old = previous.mesh;
  if (!old.topology || !supports.length) return false;
  const started = performance.now();
  const minimum = supports.reduce((size, support) => Math.min(size, support.size), Infinity);
  const topology = refineAdaptiveWhere(
    old.topology,
    minimum,
    (box) => supported(box, supports),
    state.numerical
  );
  if (topology === old.topology) return false;
  const assembled = performance.now();
  const transfer = prepareAdaptiveTransfer(old.topology, topology, state.numerical);
  work.map = remeshPhysical(previous, topology, state.domain.scope.footprint, transfer);
  refreshGrounding(work.map, work.profile);
  if (invalidation === "standalone")
    invalidateNativeProducts(
      state,
      remeshInvalidations.map((product) => product.slice("canonry:".length)),
      "adaptive topology transfer"
    );
  remapMagic(state, previous, transfer);
  // The old lattice's physical bands are no longer read; give their blocks back to the cache.
  for (const [, band] of physicalBands(previous)) previous.coverage.release(band);
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
  name: string,
  invalidation: RemeshInvalidationPolicy = "standalone"
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
  return refineWorkspace(state, supports, invalidation);
}
