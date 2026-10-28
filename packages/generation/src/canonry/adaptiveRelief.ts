// Latent relief realized at a child profile (ADR 0005): the parent's mesh-scale gradient says
// how rugged and which way; the child adds the ridge-and-valley texture its own mesh resolves.
import type { Geometry } from "geojson";
import {
  adaptiveLeafAt,
  fieldInterpolator,
  spatial,
  type Band,
  type Grid,
  type Position,
} from "@atlas/domain";
import type { GenerationState, MapProcess } from "../process";
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp, units } from "./math";
import { fractalNoise } from "./noise";
import { rebuild } from "./surface";
import { nativeContext } from "./context";
import { composeNativeAuthoring, nativePosition, parentChannels } from "./atlasWorkspace";
import { workingArray, releaseWorking } from "./physicalNumerics";

export interface ReliefSynthesis {
  changed: number;
  rmsM: number;
}
/** Per-cell proposals on the coverage; per-parent-cell sums over the (small) parent grid. */
interface Proposal {
  delta: Band;
  cell: Band;
  sums: Float64Array;
  weights: Float64Array;
}
function parentSpan(parent: Grid): number {
  if (parent.scope.resolution) return parent.scope.resolution;
  const [x0, y0, x1, y1] = parent.bounds;
  return parent.topology
    ? Math.max(x1 - x0, y1 - y0)
    : Math.max((x1 - x0) / (parent.width - 1), (y1 - y0) / (parent.height - 1));
}
function parentCell(parent: Grid, x: number, y: number): number {
  if (parent.topology) return adaptiveLeafAt(parent.topology, x, y);
  const [x0, y0, x1, y1] = parent.bounds;
  const col = clamp(Math.round(((x - x0) / (x1 - x0)) * (parent.width - 1)), 0, parent.width - 1);
  const row = clamp(Math.round(((y - y0) / (y1 - y0)) * (parent.height - 1)), 0, parent.height - 1);
  return row * parent.width + col;
}
/** Texture at one cell: amplitude from the parent's relief across one of its cells, ridges along strike. */
function cellRelief(
  map: PhysicalField,
  i: number,
  position: Position,
  elevationAt: (p: Position) => number,
  span: number,
  seed: number,
  p: PhysicalProfile
): number {
  const { x, y } = position,
    half = span / 2;
  const gx = (elevationAt({ x: x + half, y, z: 0 }) - elevationAt({ x: x - half, y, z: 0 })) / span,
    gy = (elevationAt({ x, y: y + half, z: 0 }) - elevationAt({ x, y: y - half, z: 0 })) / span;
  const gradient = Math.hypot(gx, gy);
  const amplitude =
    p.ReliefSynthesisGain *
    Math.max(0, gradient * span - p.ReliefSynthesisFloor) *
    clamp(map.RockResistance.get(i) / 1000, 0.6, 1.4);
  if (amplitude <= 0) return 0;
  // Across-strike coordinate follows the gradient; the along-strike one is compressed so the
  // texture reads as ridges parallel to the belt.
  const ax = gradient > 0 ? gx / gradient : 1,
    ay = gradient > 0 ? gy / gradient : 0;
  const across = x * ax + y * ay,
    along = (-x * ay + y * ax) / p.ReliefSynthesisAnisotropy;
  return amplitude * fractalNoise(across, along, seed ^ 0x5e1f, span / 2, 3);
}
function proposeRelief(
  map: PhysicalField,
  parent: Grid,
  footprint: Geometry,
  band: number,
  seed: number,
  p: PhysicalProfile
): Proposal {
  const mesh = map.mesh,
    span = parentSpan(parent),
    elevationAt = fieldInterpolator(parent, "elevation"),
    interior = spatial.buffer(footprint, -band),
    inside = interior ? spatial.pointCoverage(interior) : () => false,
    [bx0, by0, bx1, by1] = spatial.bounds(footprint);
  const proposal: Proposal = {
    delta: workingArray(map, "float64", "relief:delta"),
    cell: workingArray(map, "int32", "relief:parent").fill(-1),
    sums: new Float64Array(parent.active.length),
    weights: new Float64Array(parent.active.length),
  };
  for (let i = 0; i < mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0 || mesh.membership(i) !== 1) continue;
    const position = nativePosition({ map } as never, i),
      { x, y } = position;
    if (!inside(position)) continue;
    // The amplitude fades to nothing across one parent span inside the inherited band.
    const fade = clamp((Math.min(x - bx0, bx1 - x, y - by0, by1 - y) - band) / span, 0, 1);
    const relief = fade > 0 ? cellRelief(map, i, position, elevationAt, span, seed, p) : 0;
    if (relief === 0) continue;
    const id = parentCell(parent, x, y),
      delta = relief * fade,
      area = mesh.area(i);
    proposal.delta.set(i, delta);
    proposal.cell.set(i, id);
    proposal.sums[id] += delta * area;
    proposal.weights[id] += area;
  }
  return proposal;
}
/** Remove each parent cell's mean, keep land above the sea, and move the bedrock. */
function applyConserved(map: PhysicalField, proposal: Proposal): ReliefSynthesis {
  let changed = 0,
    square = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const parent = proposal.cell.get(i);
    if (parent < 0) continue;
    const floor = (map.EffectiveSeaLevel + units(1) - map.Elevation.get(i)) / 1024;
    const change = Math.max(
      proposal.delta.get(i) - proposal.sums[parent] / proposal.weights[parent],
      floor
    );
    const applied = units(change);
    if (applied === 0) continue;
    map.BedrockElevation.add(i, applied);
    rebuild(map, i);
    changed++;
    square += change * change;
  }
  return { changed, rmsM: changed ? Math.sqrt(square / changed) : 0 };
}
/**
 * Add sub-parent-cell relief to the land of `map` from `parent`'s elevation field. Amplitude is
 * the parent's relief across one of its cells (gradient × span), above a floor, times a gain and
 * the rock resistance ratio; ridges run perpendicular to the parent gradient. The mean over each
 * parent cell is removed so the parent stays authoritative at its mesh, nothing changes within
 * the inherited boundary band, and land never drops to sea level.
 */
export function synthesizeRelief(
  map: PhysicalField,
  parent: Grid,
  footprint: Geometry,
  band: number,
  seed: number,
  p: PhysicalProfile
): ReliefSynthesis {
  const proposal = proposeRelief(map, parent, footprint, band, seed, p);
  try {
    return applyConserved(map, proposal);
  } finally {
    releaseWorking(map, proposal.delta, proposal.cell);
  }
}

/** The child-profile step that realizes the relief its parent left latent. */
export function adaptiveReliefProcess(): MapProcess {
  return {
    contract: {
      id: "canonry.refine-relief",
      version: "0f62584c",
      parameters: {},
      requires: ["canonry:Elevation"],
      produces: [],
      invalidates: [],
      workspaceOnly: true,
    },
    behavior: {
      kind: "model-pass",
      applyPass(state: GenerationState, context) {
        const work = state.physical!;
        const parent = parentChannels(state).get("elevation");
        if (!work.inherited || !parent) return;
        const c = nativeContext(state, context, 0x51ef);
        const result = synthesizeRelief(
          work.map,
          parent,
          state.surface.scope.footprint,
          work.map.mesh.spacing * 2,
          c.Seed,
          work.profile
        );
        composeNativeAuthoring(work);
        context.recordCause({
          kind: "domain",
          process: "canonry.refine-relief",
          subjects: [],
          description: `Realized ridge-and-valley relief below the parent's cells on ${result.changed} cells (${Math.round(result.rmsM)} m RMS), conserving each parent cell's mean height.`,
        });
      },
    },
    validate: () => [],
  };
}
