import { placeMinimumCells, point, type AtlasFeature } from "@atlas/domain";
import { nativePosition } from "../world/atlasWorkspace";
import { placeFeature, regionOutline } from "../world/geographicRegions";
import { linkedCourse, magicPlaceGeometry } from "../world/placeGeometry";
import type { MagicField } from "../world/magicState";
import type { GenerationState } from "../process";
import type { PoiPlace } from "./poiContract";
import { fieldOf } from "./poiReads";
import { riverSuccessor } from "../water/riverKeeping";

type Attributes = (state: GenerationState, place: PoiPlace) => Record<string, unknown>;
const none: Attributes = () => ({});

/** What a kind's record is called and where it lies. Existing kinds keep their published name. */
export interface RecordShape {
  kind: string;
  layer: string;
  name: string;
  attributes?: Attributes;
}

/** A place published as a point at its anchor. */
export const siteRecord =
  ({ kind, layer, name, attributes = none }: RecordShape) =>
  (state: GenerationState, place: PoiPlace): AtlasFeature | null =>
    placeFeature(state, kind, name, place.cells, layer, attributes(state, place), undefined, {
      geometry: point(nativePosition(state.physical!, place.anchor)),
      anchor: place.anchor,
      meaning: "located site",
    });

/** A place published as its outline. A cell or two is a mark on the field, not an area. */
export const areaRecord =
  (
    { kind, layer, name, attributes = none }: RecordShape,
    weight?: (state: GenerationState, cell: number) => number
  ) =>
  (state: GenerationState, place: PoiPlace): AtlasFeature | null => {
    if (place.cells.length < placeMinimumCells.area) return null;
    const outline = regionOutline(
      state,
      place.cells,
      weight ? (cell) => weight(state, cell) : undefined
    );
    return outline
      ? placeFeature(state, kind, name, place.cells, layer, attributes(state, place), outline)
      : null;
  };

/**
 * A place a magic system grows, published as that system's class: a site at its source, a
 * course along the system's own propagation, otherwise its outline by coverage. The record's
 * kind stays `system:rule`, which the map's magic presentation reads.
 */
export const ruleRecord =
  (system: string, rule: string) =>
  (state: GenerationState, place: PoiPlace): AtlasFeature | null => {
    const field = fieldOfSystem(state, system),
      definition = field?.definition.features.find((r) => r.id === rule);
    if (!field || !definition) return null;
    const cartography = definition.cartography ?? "area";
    if (place.cells.length < placeMinimumCells[cartography]) return null;
    const extent = ruleOutline(state, field, rule, place);
    const placement = extent ? magicPlaceGeometry(state, field, rule, place.cells, extent) : null;
    if (cartography === "course" && !placement) return null;
    return placeFeature(
      state,
      `${system}:${rule}`,
      definition.name,
      place.cells,
      "magic",
      ruleAttributes(state, field, rule, place),
      extent,
      placement
    );
  };
const fieldOfSystem = (state: GenerationState, system: string) =>
  state.physical?.magic?.fields.find((f) => f.definition.id === system);
function ruleOutline(state: GenerationState, field: MagicField, rule: string, place: PoiPlace) {
  const coverage = field.coverage[rule];
  return (
    regionOutline(state, place.cells, coverage ? (i) => coverage.get(i) : undefined) ?? undefined
  );
}
function ruleAttributes(state: GenerationState, field: MagicField, rule: string, place: PoiPlace) {
  const mesh = fieldOf(state).mesh,
    area = place.cells.reduce((sum, i) => sum + mesh.area(i), 0);
  return {
    system: field.definition.id,
    rule,
    maximumIntensity: place.cells.reduce((m, i) => Math.max(m, field.intensity.get(i)), 0),
    accumulatedActivity:
      place.cells.reduce((sum, i) => sum + field.history.get(i) * mesh.area(i), 0) / area,
  };
}

/** A place published as the line its cells run along, downstream by the network's receivers. */
export const courseRecord =
  ({ kind, layer, name, attributes = none }: RecordShape) =>
  (state: GenerationState, place: PoiPlace): AtlasFeature | null => {
    if (place.cells.length < placeMinimumCells.course) return null;
    const geometry = linkedCourse(
      state,
      place.cells,
      (cell) => riverSuccessor(fieldOf(state), cell),
      true
    );
    return geometry
      ? placeFeature(state, kind, name, place.cells, layer, attributes(state, place), undefined, {
          geometry,
          anchor: place.anchor,
          meaning: "incised drainage course",
        })
      : null;
  };
