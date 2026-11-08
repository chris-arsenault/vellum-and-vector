import { standGround } from "../rock/groundLedger";
import { MapScale } from "@atlas/domain";
import { measureSlopes } from "../world/geography";
import { units } from "../world/math";
import { physicalGradients } from "../world/physicalMetric";
import { releaseWorking } from "../world/physicalNumerics";
import { applyGlaciation } from "./glacial";
import { baseSmoothing, lakeHollows } from "./base";
import { restoreFeatures } from "./causes/registry";
import { networkDivides } from "./divides";
import { transportSediment, wasteHillslopes } from "./sediment";
import { developShore } from "./shore";
import {
  blurContent,
  blurOverLand,
  contentMask,
  distance,
  isContent,
  neighborsOf,
  regionalSpan,
  releaseBlurs,
} from "./lattice";
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
/** Calibration passes fitting the parent-span blur of the relief to the captured base. */
const calibrationPasses = 5;
/** Plain-land amplification and the smallest macro relief treated as a plain. */
const minimumAmplification = 0.01,
  plainRelief = 0.0000005;
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
  keepDrainable(network, h, basin, map.scale);
  // Oversteepened ground fails and its rock, with the valleys' incision, settles downstream.
  const supply = new Float64Array(n);
  wasteHillslopes(state, h, supply);
  transportSediment(state, h, supply);
  // A slide or fan that dams a valley leaves a hollow deep and wide enough for a lake: it stays.
  const hollows = lakeHollows(state, h, network.sea);
  for (let i = 0; i < n; i++) basin[i] |= hollows[i];
  keepDrainable(network, h, basin, map.scale);
  // The sea works the shore: exposed ground is cut, the lee and the river mouths fill. Ground
  // the cut took below the datum is sea and stays there; the rest drains as before.
  const cut = developShore(state, h),
    taken = cut.map((c, j) => (c && h[j] <= 0 ? 1 : 0)) as Uint8Array;
  keepDrainable(network, h, basin, map.scale, taken);
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
          blurred[i] - blurredLevel[i],
          state.physical.map.scale.length(plainRelief)
        );
    blurContent(state, amplification, reach / 2);
  }
  return amplification;
}
/** One calibration step of a cell's amplification toward the wanted relief above its root. */
function fitted(amplification: number, wanted: number, got: number, minimumRelief: number) {
  if (wanted <= minimumRelief) return minimumAmplification;
  if (got <= minimumRelief) return amplification;
  return amplification * clamp(wanted / got, 0.4, 2.5);
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
    datum = MapScale.metres(map.EffectiveSeaLevel, "native"),
    { base, sea, lake, sink, receiver } = state.regional.network!,
    reach = state.regional.parentSpan * baseSmoothing,
    content = contentMask(state),
    macro = new Float64Array(base),
    blurred = new Float64Array(h);
  blurOverLand(state, macro, sea, reach);
  blurOverLand(state, blurred, sea, reach);
  const rugged = ruggedness(state, macro);
  for (let i = 0; i < n; i++) {
    if (!content[i] || sea[i] || lake[i] >= 0) continue;
    const exit = receiver[i] < 0 && !sink[i];
    h[i] = exit
      ? Math.max(
          MapScale.metres(state.regional.inheritedHeight.get(i), "native") - datum,
          map.scale.length(0.00000025)
        )
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
  scale: MapScale,
  held?: Uint8Array
) {
  const { receiver, order, count, level, lake } = network;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0 || basin[j] || held?.[j]) continue;
    const floor = (lake[i] >= 0 ? level[i] : h[i]) + scale.length(monotoneRise);
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
      standGround(
        map,
        i,
        datum + units(Math.max(h[i], Math.min(base[i], -map.scale.length(0.00000025)))),
        "regional"
      );
      map.CumulativeFluvialErosion.set(i, 0);
    } else {
      const ground = datum + units(h[i]) + Math.round(applied.appliedTo("Elevation", i));
      standGround(map, i, ground, "regional");
      // Ground the sea cut is not a river's incision.
      map.CumulativeFluvialErosion.set(i, cut[i] ? 0 : units(Math.max(0, base[i] - h[i])));
    }
  }
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
