import type { Geometry } from "geojson";
import type { AtlasFeature, World } from "./model";
import { spatial } from "./spatial";
import { MapScale, type RelativeMeasure } from "./mapScale";
/** One defining measure of a landmark kind, entered and stored in the declared unit. */
export interface LandmarkParameter {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  default: number;
  /** Procedural bounds resolve for a new map; recorded and authored measures keep their units. */
  generated?: {
    min: RelativeMeasure;
    max: RelativeMeasure;
    default: RelativeMeasure;
  };
  /** Advisory measures inform generation without being guaranteed. */
  advisory?: boolean;
}
/**
 * A kind is one declaration: the geometry it is drawn with, the measures that are guaranteed,
 * and the horizontal reach over which its causes act. Emplacement and maintenance read the
 * same declaration in generation.
 */
export interface LandmarkKind {
  id: string;
  label: string;
  group: string;
  geometry: "Point" | "LineString";
  description: string;
  parameters: LandmarkParameter[];
  /** Horizontal reach of the landmark's causes in metres. */
  reach(parameters: Record<string, number>): number;
  /** A magic kind injects a source of this system and publishes on the magic layer. */
  system?: string;
  /** The geographic term its name is built around. */
  term?: string;
}
/** The layer a kind's features publish on. */
export declare const landmarkLayer: (
  kind: Pick<LandmarkKind, "system"> | undefined
) => "magic" | "geology";
export interface Landmark {
  id: string;
  name: string;
  kind: string;
  geometry: Geometry;
  parameters: Record<string, number>;
  /** Index into `world.epochs`; the landmark forms after that epoch's seeded events. */
  emplacedAtEpoch: number;
  /** Who first made the record: the generator siting it, or a creator editing the result. */
  origin?: "generated" | "authored";
  areaId?: string;
  spaceId?: string;
}
export declare const landmarkKinds: LandmarkKind[];
export declare function landmarkKind(id: string): LandmarkKind | undefined;
export declare function defaultLandmarkParameters(kind: LandmarkKind): Record<string, number>;
/** Newly generated measures, converted back to the catalogue's recorded units after resolution. */
export declare function generatedLandmarkMeasures(
  kind: LandmarkKind,
  scale: MapScale
): LandmarkParameter[];
/** Every declared measure present and within range, nothing undeclared; diagnostics name the measure. */
export declare function validateLandmarkParameters(
  kind: LandmarkKind,
  parameters: Record<string, number>
): void;
/** The horizontal footprint over which the landmark's causes act. */
export declare function landmarkFootprint(
  landmark: Pick<Landmark, "kind" | "geometry" | "parameters">,
  gis?: Pick<typeof spatial, "buffer">
): Geometry;
/** The generated realization of a landmark, when generation has published one under its id. */
export declare function realizedLandmark(world: World, landmark: Landmark): AtlasFeature | null;
/**
 * Landmarks stay owned by world.landmarks; readers and selection share their semantic
 * identities. A landmark has one row: its generated realization, carrying the measured
 * signature under the authored name, or the authored record until generation has run.
 */
export declare function authoredLandmarkFeatures(
  world: World,
  gis?: Pick<typeof spatial, "buffer">
): AtlasFeature[];
