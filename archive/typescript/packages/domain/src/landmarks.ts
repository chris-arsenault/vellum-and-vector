import type { Geometry } from "geojson";
import type { AtlasFeature, World } from "./model";
import { requireThat } from "./errors";
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
  generated?: { min: RelativeMeasure; max: RelativeMeasure; default: RelativeMeasure };
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
export const landmarkLayer = (kind: Pick<LandmarkKind, "system"> | undefined) =>
  kind?.system ? "magic" : "geology";
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

const generatedLength = ([min, max, value]: readonly [number, number, number]) => ({
  min: MapScale.length(min),
  max: MapScale.length(max),
  default: MapScale.length(value),
});
const metres = (
  key: string,
  label: string,
  min: number,
  max: number,
  value: number,
  generated: readonly [number, number, number]
) => ({
  key,
  label,
  unit: "m",
  min,
  max,
  default: value,
  generated: generatedLength(generated),
});
const kilometres = (
  key: string,
  label: string,
  min: number,
  max: number,
  value: number,
  generated: readonly [number, number, number]
) => ({
  key,
  label,
  unit: "km",
  min,
  max,
  default: value,
  generated: generatedLength(generated),
});
const mountain = [
  metres("summit", "Summit elevation", 500, 9000, 5900, [0.000125, 0.00225, 0.001475]),
  metres("prominence", "Prominence", 300, 9000, 4000, [0.000075, 0.00225, 0.001]),
  kilometres("baseRadius", "Base radius", 5, 200, 30, [0.00125, 0.05, 0.0075]),
];
const capture = (value: number, fraction: number) =>
  kilometres("captureDistance", "River capture distance", 0, 1000, value, [0, 0.25, fraction]);

export const landmarkKinds: LandmarkKind[] = [
  {
    id: "volcanic-mountain",
    label: "Volcanic mountain",
    group: "Great mountain",
    geometry: "Point",
    description:
      "A plume-fed cone built every active epoch, with heat and fractures beneath it. Kilimanjaro, Fuji.",
    parameters: mountain,
    reach: (p) => MapScale.metres(p.baseRadius, "km"),
  },
  {
    id: "resistant-mountain",
    label: "Resistant-core mountain",
    group: "Great mountain",
    geometry: "Point",
    description:
      "A hard bedrock dome that erosion leaves standing as the surroundings lower. Uluru, Ben Nevis.",
    parameters: [
      metres("summit", "Summit elevation", 300, 9000, 2000, [0.000075, 0.00225, 0.0005]),
      metres("prominence", "Prominence", 200, 9000, 1500, [0.00005, 0.00225, 0.000375]),
      kilometres("baseRadius", "Base radius", 2, 200, 15, [0.0005, 0.05, 0.00375]),
    ],
    reach: (p) => MapScale.metres(p.baseRadius, "km"),
  },
  {
    id: "canyon",
    label: "Canyon",
    group: "Great canyon",
    geometry: "LineString",
    description:
      "An uplifted corridor with resistant caprock that a captured river incises along the drawn path. Grand Canyon.",
    parameters: [
      metres("depth", "Depth below rim", 100, 3000, 1500, [0.000025, 0.00075, 0.000375]),
      kilometres("rimWidth", "Rim-to-rim width", 1, 30, 15, [0.00025, 0.0075, 0.00375]),
      capture(150, 0.0375),
    ],
    reach: (p) => MapScale.metres(Math.max(p.rimWidth / 2, p.captureDistance), "km"),
  },
  {
    id: "dome-ring",
    label: "Eroded dome",
    group: "Great ring structure",
    geometry: "Point",
    description:
      "A bedrock dome of alternating resistant rings that erosion exposes as concentric ridges. The Richat structure.",
    parameters: [
      kilometres("diameter", "Diameter", 5, 200, 45, [0.00125, 0.05, 0.01125]),
      { key: "ringCount", label: "Ring count", unit: "rings", min: 1, max: 6, default: 3 },
      metres("ringRelief", "Ring relief", 20, 1000, 150, [0.000005, 0.00025, 0.0000375]),
    ],
    reach: (p) => MapScale.metres(p.diameter, "km") / 2,
  },
  {
    id: "impact-ring",
    label: "Impact structure",
    group: "Great ring structure",
    geometry: "Point",
    description:
      "An authored impact at the chosen epoch with a maintained rim and floor. Vredefort, Chicxulub.",
    parameters: [
      kilometres("diameter", "Diameter", 5, 300, 45, [0.00125, 0.075, 0.01125]),
      metres("rimHeight", "Rim height", 50, 3000, 400, [0.0000125, 0.00075, 0.0001]),
      metres("floorDepth", "Floor depth below rim", 50, 5000, 600, [0.0000125, 0.00125, 0.00015]),
    ],
    reach: (p) => MapScale.metres(p.diameter, "km") / 2,
  },
  {
    id: "escarpment",
    label: "Escarpment or rift edge",
    group: "Great escarpment",
    geometry: "LineString",
    description:
      "A fault along the drawn line; the right-hand side drops by the throw. Drakensberg, the East African Rift.",
    parameters: [
      metres("throw", "Throw", 100, 4000, 1000, [0.000025, 0.001, 0.00025]),
      kilometres("scarpWidth", "Scarp width", 1, 50, 10, [0.00025, 0.0125, 0.0025]),
    ],
    reach: (p) => MapScale.metres(p.scarpWidth, "km"),
  },
  {
    id: "falls",
    label: "Great falls",
    group: "Great falls",
    geometry: "Point",
    description:
      "A caprock step across a captured river. Below the World mesh; latent until a Region realizes it. Niagara, Victoria.",
    parameters: [
      metres("drop", "Drop", 10, 1000, 50, [0.0000025, 0.00025, 0.0000125]),
      {
        key: "discharge",
        label: "Desired discharge",
        unit: "m³/s",
        min: 0,
        max: 300000,
        default: 2400,
        generated: {
          min: MapScale.volume(0),
          max: MapScale.volume(4.6875e-15),
          default: MapScale.volume(3.75e-17),
        },
        advisory: true,
      },
      capture(50, 0.0125),
    ],
    reach: (p) => MapScale.metres(p.captureDistance, "km"),
  },
  ...magicLandmarkKinds(),
];
const kinds = new Map(landmarkKinds.map((kind) => [kind.id, kind]));

/**
 * A magic landmark is a kept source of one system at the greatest strength its setting
 * allows: the generator injects the source and holds the intensity it releases at the site.
 */
function magicLandmarkKinds(): LandmarkKind[] {
  const source = (label: string) => [
    {
      key: "intensity",
      label: `${label} at the source`,
      unit: "/1000",
      min: 100,
      max: 1000,
      default: 900,
    },
    kilometres("reach", "Source reach", 10, 300, 60, [0.0025, 0.075, 0.015]),
  ];
  const kind = (
    id: string,
    system: string,
    label: string,
    term: string,
    description: string,
    measure: string
  ): LandmarkKind => ({
    id,
    label,
    group: "Great magic source",
    geometry: "Point",
    description,
    parameters: source(measure),
    reach: (p) => MapScale.metres(p.reach, "km"),
    system,
    term,
  });
  return [
    kind(
      "fire-wellspring",
      "fire",
      "Great wellspring",
      "Wellspring",
      "A vein core of the greatest strength on a fracture-fed heat maximum; the fire runs its conduits for a hundred kilometres.",
      "Fire"
    ),
    kind(
      "aurora-vault",
      "aurora",
      "Great vault",
      "Vault",
      "Charge held in the deepest ice and frozen ground of a cold height, stilling the land around it.",
      "Charge"
    ),
    kind(
      "pressure-locus",
      "pressure",
      "Deep locus",
      "Deep",
      "A locus in the deep ocean whose rays, wakes and storms reach the coasts around it.",
      "Pressure"
    ),
    kind(
      "greenwood-heart",
      "greenwood",
      "Heartwood",
      "Heartwood",
      "The eldest stand and its spring, where sap and groundwater run deepest and the forest grows past its climate.",
      "Sap"
    ),
    kind(
      "salt-pan",
      "salt",
      "Great salt pan",
      "Pan",
      "A dead lake's bed in a closed arid basin: brine down the drainage, bed at the pit, dust on the wind.",
      "Salting"
    ),
  ];
}

export function landmarkKind(id: string): LandmarkKind | undefined {
  return kinds.get(id);
}
export function defaultLandmarkParameters(kind: LandmarkKind): Record<string, number> {
  return Object.fromEntries(kind.parameters.map((p) => [p.key, p.default]));
}
/** Newly generated measures, converted back to the catalogue's recorded units after resolution. */
export function generatedLandmarkMeasures(kind: LandmarkKind, scale: MapScale) {
  return kind.parameters.map((parameter) => {
    if (!parameter.generated) return parameter;
    const values = scale.resolve(MapScale.definitions(parameter.generated)),
      recorded = (value: number) =>
        parameter.unit === "km" ? MapScale.inUnits(value, "km") : value;
    return {
      ...parameter,
      min: recorded(values.min),
      max: recorded(values.max),
      default: recorded(values.default),
    };
  });
}
/** Every declared measure present and within range, nothing undeclared; diagnostics name the measure. */
export function validateLandmarkParameters(kind: LandmarkKind, parameters: Record<string, number>) {
  const declared = new Set(kind.parameters.map((p) => p.key));
  for (const key of Object.keys(parameters))
    requireThat(
      declared.has(key),
      "landmark_parameter",
      `${key} is not a measure of ${kind.label.toLowerCase()}.`
    );
  for (const parameter of kind.parameters) {
    const value = parameters[parameter.key];
    requireThat(
      Number.isFinite(value) && value >= parameter.min && value <= parameter.max,
      "landmark_parameter",
      `${parameter.label} must be between ${parameter.min} and ${parameter.max} ${parameter.unit}.`
    );
  }
}
/** The horizontal footprint over which the landmark's causes act. */
export function landmarkFootprint(
  landmark: Pick<Landmark, "kind" | "geometry" | "parameters">,
  gis: Pick<typeof spatial, "buffer"> = spatial
) {
  const kind = landmarkKind(landmark.kind);
  requireThat(kind, "landmark_kind", "Choose a landmark kind from the catalogue.");
  return gis.buffer(landmark.geometry, kind.reach(landmark.parameters)) ?? landmark.geometry;
}
/** The generated realization of a landmark, when generation has published one under its id. */
export function realizedLandmark(world: World, landmark: Landmark): AtlasFeature | null {
  const feature = world.features[landmark.id];
  return feature && feature.kind === "landmark" ? feature : null;
}
/**
 * Landmarks stay owned by world.landmarks; readers and selection share their semantic
 * identities. A landmark has one row: its generated realization, carrying the measured
 * signature under the authored name, or the authored record until generation has run.
 */
export function authoredLandmarkFeatures(
  world: World,
  gis?: Pick<typeof spatial, "buffer">
): AtlasFeature[] {
  const root = Object.values(world.areas).find((a) => !a.parentId)!.id;
  return (world.landmarks ?? []).map((landmark) => {
    const realized = realizedLandmark(world, landmark);
    if (realized)
      return {
        ...realized,
        name: landmark.name || realized.name,
        attributes: {
          ...realized.attributes,
          landmarkKind: landmark.kind,
          emplacedAtEpoch: landmark.emplacedAtEpoch,
        },
      };
    return {
      id: landmark.id,
      areaId: landmark.areaId ?? root,
      layerId: landmarkLayer(landmarkKind(landmark.kind)),
      kind: "landmark",
      name: landmark.name,
      geometry: landmark.geometry,
      footprint: landmarkFootprint(landmark, gis),
      detail: {},
      attributes: {
        landmarkKind: landmark.kind,
        emplacedAtEpoch: landmark.emplacedAtEpoch,
        signature: "authored",
        ...landmark.parameters,
        nameStatus: "proper",
      },
      relations: [],
      state: "authored",
      actor: "user",
      protected: true,
      generationId: null,
      causes: [],
    };
  });
}
