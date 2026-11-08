import { oceanDistance } from "../world/geography";
import { latitudeAt } from "../world/latitude";
import { distance, isContent, regionalSpan, smoothOverLength } from "./lattice";
import { materialBands } from "./material";
import { heightGradients } from "./relief";
import { clamp, naturalBand, type RegionalState } from "./state";

/**
 * Shared media the field has no band for, derived on the lattice after each round's water
 * and read by climate, cover and ice. Media the field has a band for (`OceanDistance`,
 * `FractureConductance`) are written in place. Values are per mesh cell; never published.
 */
export interface SharedMedia {
  /** Sun exposure of the slope: +1 a steep equatorward slope at high latitude, −1 its shaded opposite, 0 flat. */
  insolation: Float64Array;
  /** Cold-air pooling 0..1: how far a gentle floor lies below the surrounding smoothed surface. */
  pooling: Float64Array;
  /** Topographic wetness 0..1 over the frame's content (upslope area per contour length over slope). */
  wetness: Float64Array;
}

/** Gradient at which a slope's exposure counts in full (about 17°). */
const fullExposureGradient = 0.3;
/** Depth below the surrounding smoothed surface that pools cold air in full (m). */
// length-unit: fraction
const poolingDepth = 0.000015;
/** Smoothing length of the surrounding surface, as a share of the parent span. */
const poolingSmoothingShare = 0.5;
/** Gradient above which a floor no longer pools (air drains off a slope). */
const poolingDrainGradient = 0.05;
/** Slope floor for the wetness index: flat ground is wet, not infinitely wet. */
const wetnessSlopeFloor = 0.002;
/** Conductance (0..1000) a fully strained cell of the weakest band opens. */
const fractureOpening = 400;

/** Derive every medium from the present relief and routing; nothing without a network. */
export function deriveMedia(state: RegionalState) {
  if (!state.regional.network) return;
  const map = state.physical.map,
    n = map.mesh.count,
    media = (state.regional.media ??= {
      insolation: new Float64Array(n),
      pooling: new Float64Array(n),
      wetness: new Float64Array(n),
    });
  // The frame is open to the parent's country: a cell is as near the sea as the parent said
  // (the captured distance) or as near as the sea inside the frame, whichever is less.
  map.OpenBoundary = true;
  oceanDistance(map);
  const { gx, gy } = heightGradients(state);
  deriveInsolation(state, gx, gy, media.insolation);
  derivePooling(state, gx, gy, media.pooling);
  deriveWetness(state, media.wetness);
  deriveGeothermal(state);
}

/** Geothermal (0..1000) a fully opened fracture adds, and a cone adds at its centre. */
const fractureHeat = 300,
  coneHeat = 400;
/**
 * Geothermal re-derived from the captured value (plan: geothermal row): heat rises where the
 * fracture set opened beyond the captured conductance and near the character's cones; the
 * plume and boundary terms of the world are not captured and are left off. Read by the magic
 * engine's Fire sources.
 */
function deriveGeothermal(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    natural = naturalBand(state, "Geothermal"),
    captured = naturalBand(state, "FractureConductance"),
    cones = state.regional.character?.cones ?? [];
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const opened = Math.max(0, map.FractureConductance.get(i) - captured.get(i)) / 1000;
    let cone = 0;
    for (const c of cones) cone = Math.max(cone, 1 - distance(mesh, c.cell, i) / c.radius);
    map.Geothermal.set(
      i,
      Math.round(clamp(natural.get(i) + fractureHeat * opened + coneHeat * clamp(cone), 0, 1000))
    );
  }
}

/**
 * Equatorward exposure: the slope's downhill direction toward the equator, scaled by how
 * steep it is and how low the sun stands (the sine of the latitude).
 */
function deriveInsolation(
  state: RegionalState,
  gx: Float64Array,
  gy: Float64Array,
  into: Float64Array
) {
  const map = state.physical.map,
    profile = state.physical.profile;
  for (let i = 0; i < into.length; i++) {
    const g = Math.hypot(gx[i], gy[i]);
    if (g === 0) {
      into[i] = 0;
      continue;
    }
    const latitude = latitudeAt(profile, map, i),
      // Height rising northward descends southward: the slope faces the equator in the north.
      facing = (Math.sign(latitude) * gy[i]) / g,
      sun = Math.sin((Math.abs(latitude) * Math.PI) / 180);
    into[i] = facing * clamp(g / fullExposureGradient) * sun;
  }
}

/** A gentle floor below the surrounding surface holds the cold air that drains into it. */
function derivePooling(
  state: RegionalState,
  gx: Float64Array,
  gy: Float64Array,
  into: Float64Array
) {
  const map = state.physical.map,
    n = map.mesh.count,
    surrounding = new Float64Array(n);
  for (let i = 0; i < n; i++) surrounding[i] = MapScale.metres(map.Elevation.get(i), "native");
  smoothOverLength(state, surrounding, state.regional.parentSpan * poolingSmoothingShare);
  for (let i = 0; i < n; i++) {
    const below = surrounding[i] - MapScale.metres(map.Elevation.get(i), "native"),
      gentle = clamp(1 - Math.hypot(gx[i], gy[i]) / poolingDrainGradient);
    into[i] =
      map.WaterKindCodes.get(i) === 1 ? 0 : clamp(below / map.scale.length(poolingDepth)) * gentle;
  }
}

/** ln(a / tan β) with the routed catchment, normalized over the frame's content. */
function deriveWetness(state: RegionalState, into: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    span = regionalSpan(state);
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < into.length; i++) {
    if (!isContent(mesh, i) || map.WaterKindCodes.get(i) !== 0) {
      into[i] = NaN;
      continue;
    }
    const area = Math.max(mesh.contentArea(i), map.CatchmentArea.get(i)) / span,
      index = Math.log(area / Math.max(wetnessSlopeFloor, map.Slope.get(i)));
    into[i] = index;
    low = Math.min(low, index);
    high = Math.max(high, index);
  }
  const range = high > low ? high - low : 1;
  for (let i = 0; i < into.length; i++)
    into[i] = Number.isNaN(into[i]) ? (map.WaterKindCodes.get(i) ? 1 : 0) : (into[i] - low) / range;
}

/**
 * The fracture set: the captured conductance, opened further where the captured tectonic
 * strain is high and the material band is weak, with the ledger's total (magic's rock work)
 * on top. Read by material resistance (network cost, relief) and seepage.
 */
export function openFractures(state: RegionalState) {
  const map = state.physical.map,
    natural = naturalBand(state, "FractureConductance"),
    strain = state.regional.character!.strain,
    bands = materialBands(state),
    applied = state.regional.contributions;
  for (let i = 0; i < map.mesh.count; i++) {
    const weak = clamp(0.5 - 0.5 * bands[i]),
      opened = natural.get(i) + strain[i] * weak * fractureOpening;
    map.FractureConductance.set(
      i,
      Math.round(clamp(opened + applied.appliedTo("FractureConductance", i), 0, 1000))
    );
  }
}
import { MapScale } from "@atlas/domain";
