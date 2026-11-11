import { erode } from "../rock/groundLedger";
import { displaceGroundField } from "../rock/groundDeformation";
import type { PhysicalField } from "../world/field";
import { MapScale } from "@atlas/domain";
import { measureSlopes } from "../world/geography";
import { units } from "../world/math";
import { physicalGradients } from "../world/physicalMetric";
import { releaseWorking, workingValues } from "../world/physicalNumerics";
import { lakeHollows } from "./base";
import { restoreFeatures } from "./causes/registry";
import { networkDivides } from "./divides";
import { distance, isContent, neighborsOf, regionalSpan } from "./lattice";
import { ruggedness } from "./ruggedness";
import { materialResistance } from "./material";
import { channelCells } from "./network";
import { clamp, type NetworkWork, type ReliefWork, type RegionalState } from "./state";

/** Channel gradient at the channel threshold area, and the concavity of the longitudinal profile. */
const headwaterGradient = 0.04,
  concavity = 0.45;
/** Hillslope gradient of unweathered ground; glacial reworking and cover soften it. */
const hillslopeGradient = 0.3,
  reworkedSoftening = 0.6,
  coverSoftening = 0.2;
/** Captured lake depth where the parent published none. */
// length-unit: fraction
const defaultLakeDepth = 0.0000015;
/** The least a cell rises above its receiver, keeping the derived surface drainable. */
const monotoneRise = 0.0000000125;
/** Sideways coupling of hillslopes and the passes it is applied in. */
const hillslopeCoupling = 0.5,
  hillslopePasses = 3;
/**
 * Gradient of the captured base above which its step is climbed in place as a knickpoint: on
 * a channel, steeper than any channel profile; on a hillslope, steeper than the hillslope
 * itself (an escarpment or plateau edge, not an ordinary steep flank).
 */
const knickpointGradient = 0.025;
/** Hillslope steps from the channel over which the slope flattens toward its divide, and the floor it keeps. */
// length-unit: count
const convexityLength = 20,
  divideFloor = 0.25;
/** Extra rise of a hillslope cell on the trunk of the divide network (plan G2), at full crest strength. */
const crestGain = 0.6;
/** Crest strength above which a divide cell is a ridge the hillslope smoothing rounds toward, not with. */
const crestFixed = 0.4;

/** Per-cell rise above the receiver: the amplified process part and the unamplified base step. */
interface Increments {
  increment: Float64Array;
  step: Float64Array;
}

/**
 * Resolve the initial subcell relief once. Captured macro gradients influence its roughness,
 * but do not prescribe its blur or edge heights. Later rounds work this Ground through the
 * shared physical processes; they never reconstruct it from the captured surface.
 */
export function deriveRelief(state: RegionalState) {
  const map = state.physical.map,
    n = map.mesh.count,
    network = state.regional.network!,
    crest = networkDivides(state),
    increments = reliefIncrements(state, crest),
    amplification = ruggedness(state, network.base),
    h = new Float64Array(n),
    basin = new Uint8Array(n);
  construct(state, increments, amplification, h);
  smoothHillslopes(state, h, crest);
  for (let i = 0; i < n; i++) if (network.lake[i] >= 0 || network.bowl[i]) basin[i] = 1;
  const relief: ReliefWork = { basin };
  keepDrainable(network, h, basin, map.scale);
  const hollows = lakeHollows(state, h, network.sea);
  for (let i = 0; i < n; i++) basin[i] |= hollows[i];
  keepDrainable(network, h, basin, map.scale);
  realizeSurface(
    map,
    Float64Array.from(h, (height) => map.EffectiveSeaLevel + units(height))
  );
  state.regional.relief = relief;
  // Established landmarks restore their signatures on the written relief.
  restoreFeatures(state);
  updateSlopes(state);
}

/** The rise each cell asks above its receiver, from the network and the present media. */
function reliefIncrements(state: RegionalState, crest: Float64Array): Increments {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    network = state.regional.network!,
    { receiver, order, count, base } = network,
    thresholdArea = channelCells * regionalSpan(state) ** 2,
    increment = new Float64Array(n),
    step = new Float64Array(n),
    steps = new Int32Array(n),
    reworking = state.regional.character?.reworking;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0) continue;
    const length = distance(mesh, j, i),
      material = materialResistance(state, j);
    let gradient: number;
    if (network.channel[j]) {
      const area = Math.max(thresholdArea, network.area[j]);
      gradient = headwaterGradient * Math.sqrt(material) * (area / thresholdArea) ** -concavity;
    } else {
      // A creep-shaped hillslope is steepest above the channel and flattens toward its
      // divide; where channels are sparse (dry or resistant country) the long slopes end
      // in broad flat tops, where they are dense the divides stay sharp.
      steps[j] = steps[i] + 1;
      const reworked = 1 - reworkedSoftening * (reworking?.[j] ?? 0),
        cover = 1 - coverSoftening * clamp(map.TreeCover.get(j)),
        convexity = Math.max(divideFloor, 1 - steps[j] / convexityLength),
        // On the divide network the crest rises with the catchments it separates (plan G2),
        // along long flanks; where valley heads approach from both sides the divide is a col.
        ridge = crest[j] * clamp(steps[j] / convexityLength);
      gradient =
        hillslopeGradient * material * reworked * cover * convexity * (1 + crestGain * ridge);
    }
    // A channel falls along its whole step; a hillslope rises over one hillslope's length.
    increment[j] =
      (network.channel[j] ? length : Math.min(length, state.physical.profile.HillslopeLength)) *
      gradient;
    // A step of the captured base steeper than any profile (an escarpment, a plateau edge)
    // is macro character the path must climb where it stands: a knickpoint, not a fall
    // spread along the whole profile. It is not amplified.
    const limit = network.channel[j] ? knickpointGradient : hillslopeGradient;
    step[j] = Math.max(0, base[j] - base[i] - limit * length);
  }
  return { increment, step };
}

/**
 * Build the initial surface upward from each root. Tributaries rise from the water level
 * they join; marine ground starts with its captured bathymetric context.
 */
function construct(
  state: RegionalState,
  { increment, step }: Increments,
  amplification: Float64Array,
  h: Float64Array
) {
  const mesh = state.physical.map.mesh,
    network = state.regional.network!,
    { receiver, order, count, level, sea, base, lake } = network;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0) {
      h[j] = rootHeight(network, j, state.physical.map.scale);
      continue;
    }
    const from = lake[i] >= 0 ? level[i] : h[i];
    h[j] = from + increment[j] * amplification[j] + step[j];
  }
  for (let i = 0; i < h.length; i++) {
    if (sea[i]) h[i] = Math.min(base[i], -state.physical.map.scale.length(0.00000025));
    else if (!isContent(mesh, i)) h[i] = base[i];
  }
}

/**
 * A root's height: a lake cell lies under its water, where the parent put its floor and at
 * least a few metres down; a sink or exit cell is at its level (its base); a shore cell rises
 * just above the datum.
 */
function rootHeight(network: NetworkWork, j: number, scale: MapScale) {
  const { level, base, lake } = network;
  if (lake[j] >= 0) return level[j] - Math.max(scale.length(defaultLakeDepth), level[j] - base[j]);
  return Math.max(level[j], scale.length(0.00000025));
}

/**
 * Hillslopes are coupled sideways as well as down their own path: soil creeps across the
 * divide between two paths, so neighbouring slopes that drain to different channels meet in
 * a rounded interfluve instead of a wall. Channels and basins keep their own heights.
 */
function smoothHillslopes(state: RegionalState, h: Float64Array, crest: Float64Array) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    network = state.regional.network!,
    around = new Int32Array(mesh.stride),
    previous = new Float64Array(n),
    // A divide is a crest: its flanks round toward it, it does not round toward them.
    fixed = (i: number) =>
      crest[i] > crestFixed ||
      network.sea[i] ||
      network.channel[i] ||
      network.lake[i] >= 0 ||
      network.receiver[i] < 0 ||
      !isContent(mesh, i);
  for (let pass = 0; pass < hillslopePasses; pass++) {
    previous.set(h);
    for (let i = 0; i < n; i++) {
      if (fixed(i)) continue;
      const m = neighborsOf(mesh, i, around);
      let sum = 0,
        weight = 0;
      for (let k = 0; k < m; k++) {
        const j = around[k];
        if (network.sea[j] || !isContent(mesh, j)) continue;
        sum += previous[j];
        weight++;
      }
      if (weight) h[i] = (1 - hillslopeCoupling) * previous[i] + (hillslopeCoupling * sum) / weight;
    }
  }
}

/** The derived surface drains along its network; only basins with a cause lie below their receiver. */
function keepDrainable(network: NetworkWork, h: Float64Array, basin: Uint8Array, scale: MapScale) {
  const { receiver, order, count, level, lake } = network;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0 || basin[j]) continue;
    const floor = (lake[i] >= 0 ? level[i] : h[i]) + scale.length(monotoneRise);
    if (h[j] < floor) h[j] = floor;
  }
}

/**
 * An initial target is an explicit geometric proposal, not replacement material. Lowering
 * exposes the actual next bed and sends removed parcels to the shared load; positive relief
 * displaces the inherited package and bends its contacts. Subsequent processes own that load.
 */
export function realizeSurface(map: PhysicalField, target: ArrayLike<number>) {
  const movement = workingValues(map, "float64", "regional:initial-relief", (i) =>
    isContent(map.mesh, i) ? Math.max(0, target[i] - map.Elevation.get(i)) : 0
  );
  displaceGroundField(map, movement, "regional");
  releaseWorking(map, movement);
  for (let i = 0; i < map.mesh.count; i++)
    if (isContent(map.mesh, i))
      erode(map, i, Math.max(0, map.Elevation.get(i) - target[i]), "regional");
}

/** Height gradient (m/m) of the present elevation per cell, as two arrays. */
export function heightGradients(state: RegionalState) {
  const map = state.physical.map,
    gradients = physicalGradients(
      map.mesh,
      (i) => MapScale.metres(map.Elevation.get(i), "native"),
      map.coverage
    ),
    gx = new Float64Array(map.mesh.count),
    gy = new Float64Array(map.mesh.count);
  for (let i = 0; i < gx.length; i++) {
    gx[i] = gradients.x.get(i);
    gy[i] = gradients.y.get(i);
  }
  releaseWorking(map, gradients.x, gradients.y);
  return { gx, gy };
}
/** The field's own slope measure, so every reader of `Slope` sees one definition. */
export function updateSlopes(state: RegionalState) {
  measureSlopes(state.physical.map);
}
