import { spatial, MapScale, type AtlasFeature } from "@atlas/domain";
import { generationFeatures, writeGenerationFeature } from "../generationFeatures";
import { celsius, regionalMoisture } from "./climate";
import { cellAt, isContent } from "./lattice";
import { hinterlandOwners, placesEnabled } from "./places";
import { traceWays, type Place } from "./societyWays";
import { clamp, naturalBand, type RegionalState } from "./state";

/** Field area a resident needs (m²), and the pasture beyond the fields as a share of it. */
const fieldPerResident = MapScale.area(6.25e-10),
  pastureShare = 1.5;
/** Shares of the tree cohorts cleared on fields and on pasture, and the grass that takes their place. */
const fieldClearance = 0.8,
  pastureClearance = 0.3,
  pastureGrass = 0.3;
/** The grass that takes a field's place. */
export const fieldGrass = 0.2;
/** The steepest ground fields are laid on, and the deepest ice. */
export const steepestField = 0.12,
  iceOnField = MapScale.length(0.00000025, 0.5);
/** Travel cost (m) over which a place's pull on its land fades. */
const fieldDecay = MapScale.length(0.00075);

type Fields = { place: Int32Array; kind: Uint8Array };

/**
 * Fields and pasture (plan S2, S6): per settled place, its hinterland's cells are ranked by
 * farming suitability times travel decay and taken until the residents' need is met, pasture
 * on the next best ground. The clearance is declared on the ecology cohorts through the
 * ledger each round as the difference to the cleared target, so the engine grows on cleared
 * ground next round and the fields stay cleared without ratcheting. A ruined or abandoned
 * seat clears nothing (plan F4): its ground regrows.
 */
export function declareFields(state: RegionalState) {
  if (!placesEnabled(state.regional.input.domains)) return;
  const mesh = state.physical.map.mesh,
    places = settledPlaces(state).filter((p) => p.settled && p.residents > 0);
  if (!places.length) return;
  const { owner, cost } = hinterlandOwners(
      state,
      places.map((p) => p.cell)
    ),
    fields: Fields = {
      place: new Int32Array(mesh.count).fill(-1),
      kind: new Uint8Array(mesh.count),
    },
    byPlace = new Map<number, number[]>();
  for (let i = 0; i < mesh.count; i++) {
    if (owner[i] < 0 || !farmable(state, i)) continue;
    const list = byPlace.get(owner[i]) ?? [];
    list.push(i);
    byPlace.set(owner[i], list);
  }
  for (const place of places) allocate(state, place, byPlace.get(place.cell) ?? [], cost, fields);
  declareClearance(state, fields);
  state.regional.fields = fields;
}
/** One place's land: the best-farmed cells nearest it until its need is met, pasture beyond. */
function allocate(
  state: RegionalState,
  place: Place,
  cells: number[],
  cost: Float64Array,
  fields: Fields
) {
  const mesh = state.physical.map.mesh,
    worth = (i: number) =>
      farming(state, i) * Math.exp(-cost[i] / state.physical.map.scale.resolveMeasure(fieldDecay));
  cells.sort((a, b) => worth(b) - worth(a) || a - b);
  let need = place.residents * state.physical.map.scale.resolveMeasure(fieldPerResident),
    pasture = need * pastureShare;
  for (const i of cells) {
    if (need > 0) {
      need -= mesh.contentArea(i);
      fields.kind[i] = 1;
    } else if (pasture > 0) {
      pasture -= mesh.contentArea(i);
      fields.kind[i] = 2;
    } else break;
    fields.place[i] = place.cell;
  }
}
/**
 * The clearance as declared totals: each round the difference from the present cohorts to the
 * cleared target, against the captured cohorts, so regrowth on a field is cleared again and the
 * ledger's record is what clearing has removed in all.
 */
function declareClearance(state: RegionalState, fields: Fields) {
  const applied = state.regional.contributions,
    broadleaf = naturalBand(state, "BroadleafCover"),
    conifer = naturalBand(state, "ConiferCover");
  for (let i = 0; i < fields.kind.length; i++) {
    if (!fields.kind[i]) continue;
    const keep = 1 - (fields.kind[i] === 1 ? fieldClearance : pastureClearance),
      grass = fields.kind[i] === 1 ? fieldGrass : pastureGrass;
    toTarget(state, "BroadleafCover", i, broadleaf.get(i) * keep);
    toTarget(state, "ConiferCover", i, conifer.get(i) * keep);
    applied.add("GrassCover", i, Math.max(applied.appliedTo("GrassCover", i), grass));
  }
}
/** Declare the total that brings a band to its target from where it stands now. */
function toTarget(
  state: RegionalState,
  band: "BroadleafCover" | "ConiferCover",
  i: number,
  target: number
) {
  const applied = state.regional.contributions,
    current = state.physical.map[band].get(i);
  applied.add(band, i, applied.appliedTo(band, i) + Math.min(0, target - current));
}
const farmable = (state: RegionalState, i: number) =>
  isContent(state.physical.map.mesh, i) &&
  state.physical.map.WaterKindCodes.get(i) === 0 &&
  state.physical.map.Slope.get(i) <= steepestField &&
  state.physical.map.IceThickness.get(i) < state.physical.map.scale.resolveMeasure(iceOnField);
/** Farming suitability 0..1 on the present ground: soil, water, warmth, gentle slope. */
function farming(state: RegionalState, i: number) {
  const map = state.physical.map;
  return farmingValue(
    map.SoilDepth.get(i),
    regionalMoisture(state, i),
    celsius(state, i),
    map.Slope.get(i),
    map.scale
  );
}
/** Farming suitability from soil depth (m), plant water, degrees and slope. */
export const farmingValue = (
  soil: number,
  moisture: number,
  degrees: number,
  slope: number,
  scale: MapScale
) =>
  clamp(soil / scale.length(0.000000125, 0.5)) *
  clamp(moisture / 0.5) *
  clamp((degrees + 2) / 16) *
  clamp(1 - slope / steepestField);

/** The settled places: captured seats (inhabited or not) and the round's accepted villages. */
function settledPlaces(state: RegionalState): Place[] {
  const places = seatPlaces(state);
  for (const proposal of state.regional.proposed)
    if (proposal.accepted && !places.some((p) => p.cell === proposal.cell))
      places.push({
        feature: null,
        cell: proposal.cell,
        residents: proposal.population,
        settled: true,
      });
  return places;
}
function seatPlaces(state: RegionalState): Place[] {
  const mesh = state.physical.map.mesh,
    places: Place[] = [];
  for (const f of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    if (f.kind !== "settlement" || f.geometry.type !== "Point") continue;
    const seat = state.regional.evidence?.seats.find((s) => s.featureId === f.id),
      cell = seat?.cell ?? cellAt(mesh, f.geometry.coordinates[0], f.geometry.coordinates[1]);
    if (cell >= 0 && isContent(mesh, cell)) places.push(placeOf(f, cell));
  }
  return places;
}
const placeOf = (f: AtlasFeature, cell: number): Place => ({
  feature: f,
  cell,
  residents: Number(f.attributes.population ?? f.attributes.settlementPopulation ?? 0),
  settled: !["abandoned", "ruined"].includes(String(f.attributes.status ?? "inhabited")),
});

/**
 * At extraction (plan S1, S4, F4, politics): ways by use between the published places and the
 * control each settlement sits in. What the ways cross and the places they join is kept for the
 * ford, bridge and mill entries, which turn it into places.
 */
export function developSociety(
  state: RegionalState,
  seats: { feature: AtlasFeature; cell: number }[]
) {
  const places = seats.map((s) => placeOf(s.feature, s.cell));
  inheritControl(state, places);
  const { traffic, crossed } = traceWays(state, places);
  state.regional.crossings = { traffic, crossed, seatCells: new Set(places.map((p) => p.cell)) };
  state.regional.settled = places;
}

/** Every settlement inside a captured control polygon carries that control; nothing changes it. */
function inheritControl(state: RegionalState, places: Place[]) {
  const controls = [...generationFeatures(state, { areaId: state.regional.input.areaId })]
    .filter((f) => f.kind === "control" && f.geometry.type !== "Point")
    .map((f) => ({
      id: String(f.attributes.controlledBy ?? f.id),
      covers: spatial.pointCoverage(f.geometry),
    }));
  if (!controls.length) return;
  for (const place of places) {
    if (!place.feature || place.feature.geometry.type !== "Point") continue;
    const [x, y] = place.feature.geometry.coordinates,
      control = controls.find((c) => c.covers({ x, y, z: 0 }));
    if (!control || place.feature.attributes.controlledBy === control.id) continue;
    writeGenerationFeature(state, {
      ...place.feature,
      attributes: { ...place.feature.attributes, controlledBy: control.id },
    });
  }
}
