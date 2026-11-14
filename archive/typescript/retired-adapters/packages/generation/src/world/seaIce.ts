// SeaIceLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, truncate } from "./math";
import { meshNoise as fractalNoise } from "./noise";
import { Feature } from "./codes";
import { setIceResponse } from "../rock/groundSurfaceMedia";
import type { MapScale } from "@atlas/domain";

/** A named ice cover needs thickness at this map's scale; traces remain physical ice. */
export const hasSeaIceCover = (thickness: number, scale: MapScale) =>
  thickness >= scale.length(0.0000125);

export function seaIce(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile,
    work = seaIceWork(c.EpochIndex, map.SeaIceEvolvedEpoch, c.LocalDevelopment, c.Span),
    elapsed = c.LocalDevelopment === undefined && work > 0;
  map.SeaIceSuitability.fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    map.FeatureFlags.set(
      i,
      map.FeatureFlags.get(i) & ~(Feature.PermanentSeaIce | Feature.PermanentIceMargin)
    );
    if (map.WaterKindCodes.get(i) !== 1 || map.mesh.membership(i) !== 1) continue;
    const coherence = round(
      fractalNoise(map.mesh, map.mesh.x(i), map.mesh.y(i), c.Seed, p.SeaIceVariationScale, 3) *
        p.SeaIceSuitabilityVariation
    );
    const value = clamp(
      1000 -
        map.Temperature.get(i) -
        truncate((map.OceanCurrentStrength.get(i) * p.SeaIceCurrentResistance) / 1000) -
        truncate((map.WaveExposure.get(i) * p.SeaIceWaveResistance) / 1000) -
        truncate(map.OceanCurrentHeat.get(i) / 5) +
        coherence,
      0,
      1000
    );
    map.SeaIceSuitability.set(i, value);
  }
  // Ice extent follows the cold itself rather than a requested coverage share.
  const cutoff = 1000 - p.SeaIceFormationTemperature;
  for (let i = 0; i < map.mesh.count; i++) freezeCell(map, c, i, cutoff, work);
  if (elapsed) map.SeaIceEvolvedEpoch = c.EpochIndex;
}
function freezeCell(
  map: PhysicalField,
  c: PhysicalContext,
  i: number,
  cutoff: number,
  work: number
) {
  const p = c.Profile;
  if (map.mesh.membership(i) !== 1 || map.WaterKindCodes.get(i) !== 1) return;
  const cold = map.SeaIceSuitability.get(i),
    temperature = map.Temperature.get(i),
    formed = formedSeaIce(map, cold, cutoff, temperature, p.IceMarginTemperature),
    previous = map.IceThickness.get(i);
  if (work > 0) {
    const retained = retainedSeaIce(
      previous,
      map.IcePersistence.get(i),
      temperature - p.IceMarginTemperature,
      map.scale.length(5e-7)
    );
    setIceResponse(
      map,
      i,
      c.LocalDevelopment
        ? localSeaIce(previous, Math.max(formed, retained), work)
        : Math.max(formed, retained),
      "glaciers"
    );
  }
  if (!hasSeaIceCover(map.IceThickness.get(i), map.scale)) return;
  map.FeatureFlags.set(
    i,
    map.FeatureFlags.get(i) |
      (temperature <= p.PermanentSeaIceTemperature
        ? Feature.PermanentSeaIce
        : Feature.PermanentIceMargin)
  );
}
/** Historical work is once per epoch; local work is explicit and refresh has no material work. */
export function seaIceWork(
  epoch: number,
  evolvedEpoch: number,
  localDevelopment: boolean | undefined,
  span: number
) {
  if (localDevelopment !== undefined) return localDevelopment ? Math.max(0, span) : 0;
  return epoch >= 0 && epoch !== evolvedEpoch ? 1 : 0;
}
/** Local work approaches the current freezing/ablation response without inventing elapsed history. */
export function localSeaIce(previous: number, response: number, exposure: number) {
  return previous + (response - previous) * -Math.expm1(-Math.max(0, exposure));
}
/** Preservation slows loss of existing ice; it cannot create a shelf on an ice-free sea. */
export function retainedSeaIce(
  thickness: number,
  persistence: number,
  warmth: number,
  ablationDepth: number
) {
  const held = clamp(persistence, 0, 1),
    ablated = (Math.max(0, warmth) * Math.max(0, ablationDepth)) / (1 + held);
  return Math.max(0, Math.max(0, thickness) * held - ablated);
}
function formedSeaIce(
  map: PhysicalField,
  cold: number,
  cutoff: number,
  temperature: number,
  margin: number
) {
  return cold >= cutoff && temperature <= margin
    ? map.scale.length(0.0000125 + (cold - cutoff) * 0.0000005)
    : 0;
}
