import { measureSlopes } from "../canonry/geography";
import { units } from "../canonry/math";
import { physicalGradients } from "../canonry/physicalMetric";
import { releaseWorking } from "../canonry/physicalNumerics";
import { applyGlaciation } from "./glacial";
import { baseSmoothing, lakeHollows } from "./base";
import { featureCaps, restoreFeatures } from "./causes/registry";
import { networkDivides } from "./divides";
import { transportSediment, wasteHillslopes } from "./sediment";
import { developShore } from "./shore";
import {
  blurContent,
  contentMask,
  distance,
  isContent,
  neighborsOf,
  regionalSpan,
  releaseBlurs,
} from "./lattice";
import { ruggedness } from "./ruggedness";
import { materialBands, materialResistance } from "./material";
import { channelCells } from "./network";
import { clamp, type NetworkWork, type ReliefWork, type RegionalState } from "./state";

/** Channel gradient at the channel threshold area, and the concavity of the longitudinal profile. */
const headwaterGradient = 0.04,
  concavity = 0.45;
/** Hillslope gradient of unweathered ground; glacial reworking and cover soften it. */
const hillslopeGradient = 0.3,
  reworkedSoftening = 0.6,
  coverSoftening = 0.2;
/**
 * Length (m) of a hillslope from its channel bank to where it rounds over: the ground a step
 * between cells climbs at the hillslope gradient. A cell wider than that is mostly valley
 * floor and gentle ground, so a coarse map's step rises by one hillslope, not by its width.
 */
const hillslopeLength = 1000;
/** Captured lake depth where the parent published none. */
const defaultLakeDepth = 6;
/** Calibration passes fitting the parent-span blur of the relief to the captured base. */
const calibrationPasses = 5;
/** Amplification bounds and the smallest macro relief treated as a plain. */
const minimumAmplification = 0.01,
  maximumAmplification = 8,
  plainRelief = 2;
/** The least a cell rises above its receiver, keeping the derived surface drainable. */
const monotoneRise = 0.05;
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
 * Derive the relief from the network and the present media (spec 6.1). Every cell rises
 * above its receiver: along a channel by the concave profile of its discharge through its
 * material, on a hillslope by the material's gradient flattening toward the divide, both
 * held down inside a seat's footprint. The increments are amplified so that the relief
 * blurred to the parent span is the captured base: the parent sets the macro character, the
 * network decides where within it the peaks, cols, valleys and low ground lie. Ice then
 * carves the surface the climate allows, and cones add their construction. Re-deriving in a
 * later round reads the media as they are then from the same network, so a change updates
 * the relief rather than adding to it. Heights are metres above the present sea level.
 */
export function deriveRelief(state: RegionalState) {
  const map = state.physical.map,
    n = map.mesh.count,
    network = state.regional.network!,
    crest = networkDivides(state),
    increments = reliefIncrements(state, crest),
    amplification = calibrate(state, increments),
    h = new Float64Array(n),
    basin = new Uint8Array(n);
  construct(state, increments, amplification, h);
  conditionOnBase(state, h);
  // The calibration and conditioning shared their smoothers; nothing later blurs.
  releaseBlurs(state);
  smoothHillslopes(state, h, crest);
  buildCones(state, h);
  for (let i = 0; i < n; i++) if (network.lake[i] >= 0 || network.bowl[i]) basin[i] = 1;
  const relief: ReliefWork = { amplification, basin, iceFlux: new Float64Array(n) };
  applyGlaciation(state, h, relief);
  keepDrainable(network, h, basin);
  // Oversteepened ground fails and its rock, with the valleys' incision, settles downstream.
  const supply = new Float64Array(n);
  wasteHillslopes(state, h, supply);
  transportSediment(state, h, supply);
  // A slide or fan that dams a valley leaves a hollow deep and wide enough for a lake: it stays.
  const hollows = lakeHollows(state, h, network.sea);
  for (let i = 0; i < n; i++) basin[i] |= hollows[i];
  keepDrainable(network, h, basin);
  // The sea works the shore: exposed ground is cut, the lee and the river mouths fill. Ground
  // the cut took below the datum is sea and stays there; the rest drains as before.
  const cut = developShore(state, h),
    taken = cut.map((c, j) => (c && h[j] <= 0 ? 1 : 0)) as Uint8Array;
  keepDrainable(network, h, basin, taken);
  writeSurface(state, h, cut);
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
    bands = materialBands(state),
    thresholdArea = channelCells * regionalSpan(state) ** 2,
    cap = featureCaps(state),
    increment = new Float64Array(n),
    step = new Float64Array(n),
    steps = new Int32Array(n),
    reworking = state.regional.character?.reworking;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0) continue;
    const length = distance(mesh, j, i),
      material = materialResistance(state, bands, j);
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
    if (cap[j] > 0) gradient = Math.min(gradient, cap[j]);
    // A channel falls along its whole step; a hillslope rises over one hillslope's length.
    increment[j] = (network.channel[j] ? length : Math.min(length, hillslopeLength)) * gradient;
    // A step of the captured base steeper than any profile (an escarpment, a plateau edge)
    // is macro character the path must climb where it stands: a knickpoint, not a fall
    // spread along the whole profile. It is not amplified.
    const limit = network.channel[j] ? knickpointGradient : hillslopeGradient;
    step[j] = Math.max(0, base[j] - base[i] - limit * length);
  }
  return { increment, step };
}

/**
 * Fit the amplification so the parent-span blur of the relief is the captured base. The blurs
 * are of the frame's own cells: the exterior is fixed ground, and letting it into the blur
 * would hide a mismatch along the edge behind the exterior's agreement with itself.
 */
function calibrate(state: RegionalState, increments: Increments) {
  const n = state.physical.map.mesh.count,
    network = state.regional.network!,
    { sea, base, level } = network,
    reach = state.regional.parentSpan,
    content = contentMask(state),
    amplification = new Float64Array(n).fill(1),
    blurredBase = new Float64Array(base),
    blurredLevel = new Float64Array(level),
    blurred = new Float64Array(n),
    h = new Float64Array(n);
  for (let i = 0; i < n; i++) if (sea[i]) blurredLevel[i] = 0;
  blurContent(state, blurredBase, reach);
  blurContent(state, blurredLevel, reach);
  for (let pass = 0; pass < calibrationPasses; pass++) {
    construct(state, increments, amplification, h);
    blurred.set(h);
    for (let i = 0; i < n; i++) if (sea[i]) blurred[i] = 0;
    blurContent(state, blurred, reach);
    for (let i = 0; i < n; i++)
      if (!sea[i] && content[i])
        amplification[i] = fitted(
          amplification[i],
          blurredBase[i] - blurredLevel[i],
          blurred[i] - blurredLevel[i]
        );
    blurContent(state, amplification, reach / 2);
  }
  return amplification;
}
/** One calibration step of a cell's amplification toward the wanted relief above its root. */
function fitted(amplification: number, wanted: number, got: number) {
  if (wanted <= plainRelief) return minimumAmplification;
  if (got <= plainRelief) return amplification;
  return clamp(
    amplification * clamp(wanted / got, 0.4, 2.5),
    minimumAmplification,
    maximumAmplification
  );
}

/**
 * Condition the constructed relief on the captured base (ADR 0008): at the scales the parent
 * resolves, the relief is the parent's, exactly; the network decides the detail within them.
 * The construction carries the right detail but its own macro drift (long hillslopes flatten
 * toward their divides, channels fall at their own profile), so at the base's own smoothing
 * length the base's blur replaces the construction's, both taken over the frame's cells so
 * the one-sided blur at the edge cancels. An exit then returns to the parent's ground at the
 * edge, so a valley leaves at the height the exterior continues it; lake and sea cells stay
 * at their water.
 */
function conditionOnBase(state: RegionalState, h: Float64Array) {
  const map = state.physical.map,
    n = h.length,
    datum = map.EffectiveSeaLevel / 1024,
    { base, sea, lake, sink, receiver } = state.regional.network!,
    reach = state.regional.parentSpan * baseSmoothing,
    content = contentMask(state),
    macro = new Float64Array(base),
    blurred = new Float64Array(h);
  for (let i = 0; i < n; i++)
    if (sea[i]) {
      macro[i] = 0;
      blurred[i] = 0;
    }
  blurContent(state, macro, reach);
  blurContent(state, blurred, reach);
  const rugged = ruggedness(state, macro);
  for (let i = 0; i < n; i++) {
    if (!content[i] || sea[i] || lake[i] >= 0) continue;
    const exit = receiver[i] < 0 && !sink[i];
    h[i] = exit
      ? Math.max(state.regional.inheritedHeight.get(i) / 1024 - datum, 1)
      : macro[i] + rugged[i] * (h[i] - blurred[i]);
  }
}

/**
 * Build the surface upward from each root: tributaries rise from the water level they join.
 * Beyond the frame the surface is the exterior's own base, so the blur that calibrates the
 * relief sees the country continue instead of falling to nothing at the edge.
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
      h[j] = rootHeight(network, j);
      continue;
    }
    const from = lake[i] >= 0 ? level[i] : h[i];
    h[j] = from + increment[j] * amplification[j] + step[j];
  }
  for (let i = 0; i < h.length; i++) {
    if (sea[i]) h[i] = Math.min(base[i], -1);
    else if (!isContent(mesh, i)) h[i] = base[i];
  }
}

/**
 * A root's height: a lake cell lies under its water, where the parent put its floor and at
 * least a few metres down; a sink or exit cell is at its level (its base); a shore cell rises
 * just above the datum.
 */
function rootHeight(network: NetworkWork, j: number) {
  const { level, base, lake } = network;
  if (lake[j] >= 0) return level[j] - Math.max(defaultLakeDepth, level[j] - base[j]);
  return Math.max(level[j], 1);
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

/** Constructional relief: volcanic cones built on the surface they rose through. */
function buildCones(state: RegionalState, h: Float64Array) {
  const mesh = state.physical.map.mesh,
    sea = state.regional.network!.sea;
  for (const cone of state.regional.character?.cones ?? [])
    for (let i = 0; i < mesh.count; i++) {
      if (sea[i]) continue;
      const d = distance(mesh, cone.cell, i);
      if (d <= cone.radius) h[i] += cone.height * (1 - d / cone.radius) ** 1.5;
    }
}

/** The derived surface drains along its network; only basins with a cause lie below their receiver. */
function keepDrainable(
  network: NetworkWork,
  h: Float64Array,
  basin: Uint8Array,
  held?: Uint8Array
) {
  const { receiver, order, count, level, lake } = network;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0 || basin[j] || held?.[j]) continue;
    const floor = (lake[i] >= 0 ? level[i] : h[i]) + monotoneRise;
    if (h[j] < floor) h[j] = floor;
  }
}

/**
 * Write the derived heights with the ledger's relief contributions on top. The halo keeps
 * its inherited exterior. Incision below the captured base is booked as cumulative fluvial
 * erosion, which the landform classifier and the valley extraction read.
 */
function writeSurface(state: RegionalState, h: Float64Array, cut: Uint8Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    datum = map.EffectiveSeaLevel,
    { sea, base } = state.regional.network!,
    applied = state.regional.contributions;
  for (let i = 0; i < h.length; i++) {
    if (!isContent(mesh, i)) continue;
    if (sea[i]) {
      // The captured sea floor, unless the shore's work raised it toward a bar or delta.
      map.Elevation.set(i, datum + units(Math.max(h[i], Math.min(base[i], -1))));
      map.CumulativeFluvialErosion.set(i, 0);
    } else {
      map.Elevation.set(i, datum + units(h[i]) + Math.round(applied.appliedTo("Elevation", i)));
      // Ground the sea cut is not a river's incision.
      map.CumulativeFluvialErosion.set(i, cut[i] ? 0 : units(Math.max(0, base[i] - h[i])));
    }
    map.BedrockElevation.set(i, map.Elevation.get(i) - map.SedimentThickness.get(i));
  }
}

/** Height gradient (m/m) of the present elevation per cell, as two arrays. */
export function heightGradients(state: RegionalState) {
  const map = state.physical.map,
    gradients = physicalGradients(map.mesh, (i) => map.Elevation.get(i) / 1024, map.coverage),
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
