import { MapScale, fieldChannelName, generateBand, putChannel } from "@atlas/domain";
import { humanLayersOf } from "./human/humanLayers";
import { held, leadingOf, type TraditionField } from "./human/identityReads";
import { knownPlaces } from "./human/placeRegistry";
import { knownTraditions, type Tradition, type TraditionKind } from "./human/traditions";
import { generatedFeature, generatedId, putGenerated } from "./mapFeatures";
import type { GenerationState } from "./process";
import { shapeOfSamples } from "./landShapes";
import { publishPoliticalRegions } from "./worldPoliticalRegions";

/**
 * Regions and territories read from the identity column and published. A tongue, faith or
 * custom is a distribution: the share of each cell's people who hold it, so regions overlap
 * and follow no border. A realm's territory is the land where most people hold its
 * allegiance; its claim is every cell where anyone still does, beneath a newer one or not.
 */
const distributed: TraditionKind[] = ["tongue", "faith", "custom"];
/** The share of a cell's people holding a realm's allegiance at which it controls the cell. */
const firmlyHeld = 0.75;

/** Per tradition code of a kind: the share of each cell's people who hold it. */
function shares(state: GenerationState, field: TraditionField) {
  const map = state.physical!.map,
    layers = humanLayersOf(map),
    // hpc-exempt: one band per tradition, a few dozen on a map.
    byCode = new Map<number, Float64Array>();
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const column = layers.column(cell);
    let everyone = 0;
    for (const layer of column) everyone += layer.people;
    if (!(everyone > 0)) continue;
    for (const [code, people] of held(column, field)) {
      if (!byCode.has(code)) byCode.set(code, new Float64Array(map.mesh.count));
      byCode.get(code)![cell] = people / everyone;
    }
  }
  return byCode;
}
function channel(state: GenerationState, name: string, values: Float64Array) {
  const samples = state.physical!.samples;
  putChannel(
    state.surface,
    fieldChannelName(name),
    "ratio",
    generateBand(
      state.surface.coverage,
      "float64",
      name,
      (i) => values[samples.get(i)] ?? 0,
      samples.length
    )
  );
}
/** Each tongue, faith and custom as the share of every cell's people who hold it. */
export function publishIdentities(state: GenerationState) {
  const world = state.domain.world;
  for (const kind of distributed) {
    const held = shares(state, kind);
    for (const tradition of knownTraditions(state)) {
      const values = tradition.kind === kind && held.get(tradition.code),
        entity = world.entities[tradition.entity];
      if (!values || !entity) continue;
      channel(state, `${entity.kind}:${entity.id}`, values);
      // Everyone who holds a tongue uses it: knowledge and use are one distribution here.
      if (kind === "tongue") channel(state, `languageUse:${entity.id}`, values);
    }
  }
}
function territory(
  state: GenerationState,
  realm: Tradition,
  kind: "sovereignty" | "control" | "claim",
  belongs: (cell: number) => boolean
) {
  const samples = state.physical!.samples,
    shape = shapeOfSamples(state, (i) => belongs(samples.get(i))),
    entity = state.domain.world.entities[realm.entity];
  if (!shape || !entity) return;
  const seat = knownPlaces(state).find((place) => place.id === realm.seat),
    layer = kind === "claim" ? "claims" : kind,
    relation = { sovereignty: "sovereign", control: "controlledBy", claim: "claimedBy" }[kind],
    feature = generatedFeature(
      state,
      `${kind}:${entity.id}`,
      `${entity.name} ${kind}`,
      kind,
      layer,
      shape,
      {
        status: seat ? "active" : "seatless",
        founded: realm.founded,
        ...(seat ? { seat: generatedId(state, seat.id) } : {}),
        boundaryDerivation: "allegiance-held",
      }
    );
  feature.relations = [{ targetId: entity.id, kind: relation }];
  feature.causes = [
    `${realm.founded}: the realm was founded${seat ? "" : "; its seat has since emptied"}. Its ${kind} is the land where ${kind === "claim" ? "anyone still holds" : "most people hold"} its allegiance.`,
  ];
  putGenerated(state, feature);
  // A realm that spans a continent is drawn in its geographic parts as well.
  if (kind === "sovereignty") publishPoliticalRegions(state, feature);
}
/** What a realm is made of: everyone who holds with it, and the living places it leads. */
function describeRealm(
  state: GenerationState,
  realm: Tradition,
  anyone: { [cell: number]: number },
  leads: (cell: number) => boolean
) {
  const map = state.physical!.map,
    layers = humanLayersOf(map),
    entity = state.domain.world.entities[realm.entity];
  if (!entity) return;
  let people = 0;
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (anyone[cell] > 0)
      people +=
        anyone[cell] * layers.people(cell) * MapScale.areaUnits(map.mesh.area(cell), "m2", "km2");
  const places = knownPlaces(state).filter(
    (place) => !place.abandoned && !place.absorbedBy && leads(place.anchor)
  ).length;
  entity.attributes = { ...entity.attributes, character: { people: Math.round(people), places } };
}
/** Each realm's territory where most hold its allegiance, and its claim where anyone does. */
export function publishRealms(state: GenerationState) {
  const leading = leadingOf(state.physical!.map, "allegiance"),
    claimed = shares(state, "allegiance");
  for (const realm of knownTraditions(state)) {
    const anyone = claimed.get(realm.code);
    // A realm that ended holds nothing: its people took up what it joined or broke from.
    if (realm.kind !== "allegiance" || realm.ended || !anyone) continue;
    describeRealm(state, realm, anyone, (cell) => leading.code[cell] === realm.code);
    territory(state, realm, "sovereignty", (cell) => leading.code[cell] === realm.code);
    // It controls the land where its allegiance is firmly held, not merely the most held.
    territory(state, realm, "control", (cell) => anyone[cell] >= firmlyHeld);
    territory(state, realm, "claim", (cell) => anyone[cell] > 0);
  }
}
