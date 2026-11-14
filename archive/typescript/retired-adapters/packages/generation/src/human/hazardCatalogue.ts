import { MapScale } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { compileLayerMix, type CompiledLayerMix } from "./layerCatalogue";

/**
 * What the land does to the places on it within a human era, as chances read from the ground
 * a place stands on. A hazard names how it acts on people's layers; what each layer gives up
 * to that is the layer catalogue's. Meetings between magic systems add their own hazards where
 * magic is worked into people's lives.
 */
export interface LandHazard {
  readonly kind: string;
  /** How it acts on the layers it falls on. */
  readonly mix: CompiledLayerMix;
  /** How hard an ordinary one falls, where 1 is a full attack. */
  readonly severity: number;
  /** The chance in a year that one strikes this cell. */
  yearly(map: PhysicalField, cell: number): number;
  readonly cause: string;
}
/** Steep iced ground sheds an avalanche, at this yearly chance. */
export const avalancheSlope = 0.15,
  avalancheIce = MapScale.length(0.00000025, 0.5),
  avalancheRate = 0.002;
/** The share of a river's floods that are disasters. */
export const floodRate = 0.02;
/** A coast low and near the sea takes a tsunami, at this yearly chance at full strain. */
export const waveHeight = MapScale.length(0.000005, 0.5),
  waveShore = MapScale.length(0.0025),
  tsunamiRate = 0.00001;
export const tsunamiHazard = { severity: 0.4, radius: MapScale.length(0.0025) };

const lowCoast = (map: PhysicalField, cell: number) =>
  map.Elevation.get(cell) - map.EffectiveSeaLevel <
    MapScale.inUnits(map.scale.resolveMeasure(waveHeight), "native") &&
  map.OceanDistance.get(cell) >= 0 &&
  map.OceanDistance.get(cell) < map.scale.resolveMeasure(waveShore);

export const landHazards: readonly LandHazard[] = [
  {
    kind: "avalanche",
    mix: compileLayerMix({ scour: 1 }),
    severity: 0.5,
    yearly: (map, cell) =>
      map.Slope.get(cell) > avalancheSlope &&
      map.IceThickness.get(cell) > map.scale.resolveMeasure(avalancheIce)
        ? avalancheRate
        : 0,
    cause: "Snow-bearing steep ground let go above the place.",
  },
  {
    kind: "flood",
    mix: compileLayerMix({ drown: 1 }),
    severity: 0.12,
    yearly: (map, cell) => map.FloodFrequency.get(cell) * floodRate,
    cause: "The river rose over the ground the place stands on.",
  },
  {
    kind: "tsunami",
    mix: compileLayerMix({ drown: 0.7, shake: 0.3 }),
    severity: tsunamiHazard.severity,
    yearly: (map, cell) =>
      lowCoast(map, cell) ? (map.TectonicStrain.get(cell) / 1000) * tsunamiRate : 0,
    cause: "A straining coast threw the sea over the low shore.",
  },
];
