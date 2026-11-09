import {
  point,
  population,
  spatial,
  type AtlasFeature,
  type SocietyCommunity,
} from "@atlas/domain";
import { generationFeature, generationFeatures } from "../../generationFeatures";
import { generatedFeature, generatedId, putGeneratedDetail } from "../../mapFeatures";
import type { GenerationState, HumanRound } from "../../process";
import { regionalFeature, regionalId } from "../../regional/extraction/features";
import { cellAt, positionOf } from "../../regional/lattice";
import type { ProposedPlace, RegionalState } from "../../regional/state";
import { demandedKinds } from "../../societyDemand";
import { mappedSociety } from "../../societyMapScope";
import { ruinFields, type RuinField } from "../../societyRuins";
import type { PoiPlace } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { featureCell, fieldOf, heldFor, inhabited } from "../poiReads";

/**
 * Where settlements and ruins come from: the society simulation's communities and the camps its
 * rounds left, and on a refined map what the parent left and what this map proposed. These read
 * the simulation, never the published records, and build the record each place publishes as.
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

/** Why the settlement sits where it does; open plain is the absence of a site. */
function siteAttributes(c: SocietyCommunity) {
  return {
    siteKind: c.site?.kind ?? "plain",
    siteReason: c.site?.reason ?? "open country, where its people are",
    fortress: c.site?.fortress ?? false,
  };
}
function communityNameMetadata(c: SocietyCommunity) {
  return {
    namingLanguage: c.naming?.language ?? null,
    namingCulture: c.naming?.culture ?? null,
    namedInEra: c.naming?.era ?? c.founded,
  };
}
const mappedOf = (state: GenerationState) =>
  heldFor(state, "society:mapped", () => mappedSociety(state, state.society!.region));

function communityFeature(state: GenerationState, c: SocietyCommunity) {
  const region = state.society!.region,
    people = population(c),
    urban = Math.min(people, c.settlement?.population ?? 0);
  const feature = generatedFeature(
    state,
    `community:${c.id}`,
    c.name,
    "settlement",
    c.status === "inhabited" ? "settlements" : "ruins",
    { type: "Point", coordinates: [c.position.x, c.position.y] },
    {
      communityId: c.id,
      population: urban,
      communityPopulation: people,
      settlementPopulation: urban,
      ruralPopulation: people - urban,
      groups: c.groups,
      livelihoods: c.support,
      status: c.status,
      founded: c.founded,
      representedAreaKm2: c.areaKm2,
      ...siteAttributes(c),
      worksDemanded: demandedKinds(state, c.id),
      ...mappedOf(state).hierarchy.get(c.id),
      ...communityNameMetadata(c),
    }
  );
  feature.causes = [...c.causes, ...region.history.map((e) => `${e.id}: ${e.causes.join(" ")}`)];
  return feature;
}
/** The mapped communities of a status, on a map that ran its own society. */
function simulatedPlaces(
  state: GenerationState,
  kind: PoiKindId,
  wanted: (c: SocietyCommunity) => boolean
): PoiPlace[] {
  const region = state.society?.region;
  if (!region) return [];
  const { mapped } = mappedOf(state);
  return region.communities
    .filter((c) => c.founded && mapped.has(c.id) && wanted(c))
    .map((c) =>
      lazyPlace(kind, generatedId(state, `community:${c.id}`), cellOf(state, c.position), () =>
        communityFeature(state, c)
      )
    )
    .filter((place) => place.anchor >= 0 || !state.physical);
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
    recorded = (c: SocietyCommunity) =>
      captured.some((f) => f.attributes.communityId === c.id || f.name === c.name);
  return society.communities
    .filter((c) => c.founded && wanted(c) && covered(c.position) && !recorded(c))
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
    if (!isRefined(state)) return simulatedPlaces(state, "settlement", lives);
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

function roundRuin(state: GenerationState, round: HumanRound, ruin: HumanRound["ruins"][number]) {
  const major = ruin.major!;
  const feature = generatedFeature(
    state,
    `round:${round.era}:${major.communityId}`,
    ruin.name,
    "settlement",
    "ruins",
    { type: "Point", coordinates: [ruin.x, ruin.y] },
    {
      communityId: major.communityId,
      era: round.era,
      epoch: round.epoch,
      round: true,
      status: "ruined",
      population: 0,
      peakPopulation: ruin.peak,
      communityPopulation: major.population,
      siteKind: ruin.siteKind,
      siteReason: ruin.siteReason,
      founded: major.founded,
    }
  );
  feature.causes = major.causes;
  return feature;
}
function ruinField(state: GenerationState, { round, ruin, mark, at }: RuinField) {
  const feature = generatedFeature(
    state,
    `ruin-field:${round.era}:${ruin.name}`,
    ruin.name,
    "settlement",
    "ruins",
    { type: "Point", coordinates: [at.x, at.y] },
    {
      era: round.era,
      epoch: round.epoch,
      round: true,
      ruinField: mark,
      status: "ruined",
      population: 0,
      peakPopulation: ruin.peak,
      siteKind: ruin.siteKind,
      siteReason: ruin.siteReason,
    }
  );
  feature.causes = [
    `${round.era} camp on ${mark}: the ground the band worked outlasted the band, and the mesh resolves it.`,
  ];
  return feature;
}
/** What earlier rounds left: their major camps, and the marks the mesh resolves of the others. */
function roundPlaces(state: GenerationState): PoiPlace[] {
  const camps = (state.rounds ?? []).flatMap((round) =>
    round.ruins.flatMap((ruin) =>
      ruin.major
        ? [
            lazyPlace(
              "ruin",
              generatedId(state, `round:${round.era}:${ruin.major.communityId}`),
              cellOf(state, ruin),
              () => roundRuin(state, round, ruin)
            ),
          ]
        : []
    )
  );
  const fields = state.society
    ? ruinFields(state).map((field) =>
        lazyPlace(
          "ruin",
          generatedId(state, `ruin-field:${field.round.era}:${field.ruin.name}`),
          cellOf(state, field.at),
          () => ruinField(state, field)
        )
      )
    : [];
  return [...camps, ...fields].filter((place) => place.anchor >= 0 || !state.physical);
}
const goneStatus = ["abandoned", "ruined"];
const isRuinRecord = (f: AtlasFeature) =>
  f.layerId === "ruins" || goneStatus.includes(String(f.attributes.status));
/** Every place on this map that people have left. */
export const ruinPlaces = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "places:ruin", () => {
    const gone = (c: SocietyCommunity) => !lives(c);
    if (!isRefined(state)) return [...simulatedPlaces(state, "ruin", gone), ...roundPlaces(state)];
    const captured = capturedSeats(state);
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
