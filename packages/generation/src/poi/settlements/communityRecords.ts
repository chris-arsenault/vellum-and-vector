import {
  canonicalPosition,
  point,
  spatial,
  type AtlasFeature,
  type SocietyCommunity,
} from "@atlas/domain";
import { generationFeature, generationFeatures } from "../../generationFeatures";
import { generatedFeature, generatedId, putGeneratedDetail } from "../../mapFeatures";
import type { GenerationState } from "../../process";
import { regionalFeature, regionalId } from "../../regional/extraction/features";
import { cellAt, positionOf } from "../../regional/lattice";
import type { ProposedPlace, RegionalState } from "../../regional/state";
import type { PoiPlace } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { featureCell, fieldOf, heldFor, inhabited } from "../poiReads";
import { landPlaces } from "./landPlaces";

/**
 * Where settlements and ruins come from. A map that lived its own people reads them from the
 * land's layers (`landPlaces`); a refined map reads what its parent left and what it proposed.
 * These build the record each place publishes as and never read the published records.
 */

export const isRefined = (state: GenerationState): state is RegionalState => "regional" in state;
/** The society this map holds, which a refined map reads as captured. */
export const societyRegionOf = (state: GenerationState) =>
  isRefined(state)
    ? state.domain.world.societies?.[state.regional.input.areaId]
    : state.society?.region;
/** Whether a place on this map can stand yet: a refined map has no ground before its rounds. */
export const developed = (state: GenerationState) => !isRefined(state) || state.regional.round > 0;
/** The cell under a position, or -1 on a map with no physical field. */
export const cellOf = (state: GenerationState, p: { x: number; y: number }) =>
  state.physical ? cellAt(fieldOf(state).mesh, p.x, p.y) : -1;
/** A place whose record is built when something first reads it. */
export function lazyPlace(
  kind: PoiKindId,
  id: string,
  anchor: number,
  build: () => AtlasFeature
): PoiPlace {
  let record: AtlasFeature | undefined;
  return {
    id,
    kind,
    anchor,
    cells: anchor >= 0 ? [anchor] : [],
    get feature() {
      return (record ??= build());
    },
  };
}
/** The identity of this map's own record of a key. */
export const localId = (state: GenerationState, key: string) =>
  isRefined(state) ? regionalId(state, key) : generatedId(state, key);
/** This map's own record of a key: a refined map's are its products, cleared before each run. */
export function localRecord(
  state: GenerationState,
  key: string,
  name: string,
  kind: string,
  layerId: string,
  geometry: AtlasFeature["geometry"],
  attributes: Record<string, unknown>
) {
  return isRefined(state)
    ? regionalFeature(state, key, kind, layerId, geometry, attributes, name)
    : generatedFeature(state, key, name, kind, layerId, geometry, attributes);
}
/**
 * A place's record. A refined map publishes in several passes while its seats move and take on
 * control, so what is already on the map, captured or written earlier, is left as it stands.
 */
export function onceWritten(state: GenerationState, place: PoiPlace) {
  const feature = place.feature;
  return !feature || (isRefined(state) && generationFeature(state, feature.id)) ? null : feature;
}

/** The settlement records the parent left on this refined map. */
const capturedSeats = (state: RegionalState) =>
  [...generationFeatures(state, { areaId: state.regional.input.areaId })].filter(
    (f) =>
      f.kind === "settlement" &&
      f.geometry.type === "Point" &&
      f.attributes.developedBy !== "regional"
  );
/** A seat follows the evidence wherever the developed ground has moved it. */
const seatCell = (state: RegionalState, id: string, otherwise: () => number) =>
  state.regional.evidence?.seats.find((seat) => seat.featureId === id)?.cell ?? otherwise();

function capturedPlace(state: RegionalState, kind: PoiKindId, feature: AtlasFeature): PoiPlace {
  const anchor = seatCell(state, feature.id, () => featureCell(state, feature));
  return { id: feature.id, kind, cells: [anchor], anchor, feature };
}
function knownSeat(state: RegionalState, c: SocietyCommunity) {
  const feature = regionalFeature(
    state,
    `known-seat:${c.id}`,
    "settlement",
    c.status === "inhabited" ? "settlements" : "ruins",
    point(c.position),
    { communityId: c.id, population: c.settlement?.population ?? 0, status: c.status },
    c.name
  );
  feature.name = c.name;
  feature.placeId = c.id;
  return feature;
}
/** Founded communities in this frame that the parent left no record of. */
function knownPlaces(
  state: RegionalState,
  kind: PoiKindId,
  captured: readonly AtlasFeature[],
  wanted: (c: SocietyCommunity) => boolean
): PoiPlace[] {
  const society = societyRegionOf(state);
  if (!society) return [];
  const covered = spatial.pointCoverage(state.surface.scope.footprint),
    reference = state.domain.world.reference,
    bounds = spatial.bounds(reference.domain),
    recorded = (c: SocietyCommunity) =>
      captured.some((f) => f.attributes.communityId === c.id || f.name === c.name);
  return society.communities
    .filter(
      (c) =>
        c.founded &&
        wanted(c) &&
        covered(canonicalPosition(reference, c.position, bounds)) &&
        !recorded(c)
    )
    .map((c) => {
      const id = regionalId(state, `known-seat:${c.id}`);
      return lazyPlace(
        kind,
        id,
        seatCell(state, id, () => cellOf(state, c.position)),
        () => knownSeat(state, c)
      );
    });
}
function village(state: RegionalState, proposal: ProposedPlace) {
  return regionalFeature(
    state,
    `village:${proposal.cell}`,
    "settlement",
    "settlements",
    point(positionOf(state.physical.map.mesh, proposal.cell)),
    {
      population: proposal.population,
      settlementPopulation: proposal.population,
      status: "inhabited",
      founded: "Revealed in regional detail",
      scale: "village",
      siteKind: proposal.siteKind,
      siteReason: proposal.siteReason,
    },
    "Village"
  );
}

const lives = (c: SocietyCommunity) => c.status === "inhabited";
/** Every inhabited place on this map. */
export const settlementPlaces = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "places:settlement", () => {
    // A map that lived its own people reads its places from the land.
    if (!isRefined(state)) return landPlaces(state, "settlement");
    const captured = capturedSeats(state);
    return [
      ...captured
        .filter((f) => f.layerId === "settlements" && inhabited(f))
        .map((f) => capturedPlace(state, "settlement", f)),
      ...knownPlaces(state, "settlement", captured, lives),
      ...state.regional.proposed
        .filter((proposal) => proposal.accepted)
        .map((proposal) =>
          lazyPlace(
            "settlement",
            regionalId(state, `village:${proposal.cell}`),
            proposal.cell,
            () => village(state, proposal)
          )
        ),
    ].filter((place) => place.anchor >= 0);
  });

const goneStatus = ["abandoned", "ruined"];
const isRuinRecord = (f: AtlasFeature) =>
  f.layerId === "ruins" || goneStatus.includes(String(f.attributes.status));
/** Every place on this map that people have left. */
export const ruinPlaces = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "places:ruin", () => {
    if (!isRefined(state)) return landPlaces(state, "ruin");
    const gone = (c: SocietyCommunity) => !lives(c),
      captured = capturedSeats(state);
    return [
      ...captured.filter(isRuinRecord).map((f) => capturedPlace(state, "ruin", f)),
      ...knownPlaces(state, "ruin", captured, gone),
    ].filter((place) => place.anchor >= 0);
  });

/**
 * The record a settlement or ruin publishes as. A community already drawn on this map or a
 * coarser one is a finer drawing of that subject and keeps its identity: that write happens
 * here, and no second record follows.
 */
export function communityRecord(state: GenerationState, place: PoiPlace): AtlasFeature | null {
  const feature = place.feature;
  if (!feature || isRefined(state)) return onceWritten(state, place);
  const id = feature.attributes.communityId;
  if (id === undefined || feature.attributes.round) return feature;
  const kept = putGeneratedDetail(
    state,
    { ...feature, attributes: { ...feature.attributes, poi: place.kind } },
    (f) => f.kind === "settlement" && f.attributes.communityId === id,
    { kind: "settlement" }
  );
  return kept ? null : feature;
}
