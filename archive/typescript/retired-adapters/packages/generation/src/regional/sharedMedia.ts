import { oceanDistance } from "../world/geography";
import { shoreDistance } from "../processes/climateProcesses";
import { bindOperation, readOperation } from "../processOperation";
import { physicalContext } from "../world/context";
import { latitudeAt } from "../world/latitude";
import { frameEdge, smoothOverLength } from "./lattice";
import { heightGradients } from "./relief";
import { clamp, naturalBand, type RegionalState } from "./state";

/**
 * Shared media the field has no band for, derived on the lattice after each round's water
 * and read by climate, cover and ice. OceanDistance uses its shared field band.
 * These derived values never create material, fractures or heat sources.
 */
export interface SharedMedia {
  /** Sun exposure of the slope: +1 a steep equatorward slope at high latitude, −1 its shaded opposite, 0 flat. */
  insolation: Float64Array;
  /** Cold-air pooling 0..1: how far a gentle floor lies below the surrounding smoothed surface. */
  pooling: Float64Array;
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

/** The selected coastal owner accepts captured maritime conditions at the open frame. */
export function bindRegionalOceanDistance(state: RegionalState) {
  const map = state.physical.map;
  map.OpenBoundary = true;
  const captured = naturalBand(state, "OceanDistance");
  bindOperation(map, shoreDistance.operation, () =>
    oceanDistance(map, undefined, (i) => (frameEdge(map.mesh, i) ? captured.get(i) : -1))
  );
}

/** Derive every medium from the present relief and routing; nothing without a network. */
export function deriveMedia(state: RegionalState) {
  if (!state.regional.network) return;
  const map = state.physical.map,
    n = map.mesh.count,
    media = (state.regional.media ??= {
      insolation: new Float64Array(n),
      pooling: new Float64Array(n),
    });
  // Captured maritime context enters only through the frame. Interior distances follow
  // the child's current coast, including shores that moved since capture.
  readOperation(map, shoreDistance.operation, {
    map,
    context: physicalContext(state.regional.input.seed, 0, state.physical.profile),
  });
  const { gx, gy } = heightGradients(state);
  deriveInsolation(state, gx, gy, media.insolation);
  derivePooling(state, gx, gy, media.pooling);
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

import { MapScale } from "@atlas/domain";
