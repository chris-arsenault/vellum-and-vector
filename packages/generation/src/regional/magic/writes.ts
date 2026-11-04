import type { AtlasFeature, Band } from "@atlas/domain";
import { heldCharge } from "../../canonry/magicFeedback";
import { units } from "../../canonry/math";
import { reservoirAmount, type MagicField } from "../../canonry/magicState";
import { hashUnit } from "../../canonry/noise";
import { generationFeatures } from "../../generationFeatures";
import { cellAt, frameEdge, isContent, neighborsOf, regionalSpan } from "../lattice";
import { clamp, naturalBand, type RegionalState } from "../state";

/** Intensity (0..1000) from which a conduit system opens the fractures it runs, as the world's conduits do. */
const conduitIntensity = 230;

/**
 * What the systems do to the ground, as declared ledger totals (plan M5): rock hardening and
 * weakening by each system's intensity, and the opening of the fractures a conduit system
 * runs. A re-evaluation declares the totals again and the ledger writes the difference.
 */
export function declareRockWrites(state: RegionalState, captured: Map<string, Band>) {
  const map = state.physical.map,
    mesh = map.mesh,
    applied = state.regional.contributions,
    fields = enabledFields(state);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i) || map.WaterKindCodes.get(i) === 1) continue;
    let rock = 0,
      conduit = 0;
    for (const field of fields) {
      const intensity = field.intensity.get(i),
        effects = field.definition.effects,
        // The captured rock already holds the parent's hardening: declare the change in
        // intensity since the capture, not the whole (checklist, magic-rocks row).
        gained = intensity - (captured.get(field.definition.id)?.get(i) ?? 0);
      rock += (gained / 1000) * effects.rockResistance;
      if (effects.conduitOpening > 0 && intensity >= conduitIntensity && field.sealed.get(i) <= 0)
        conduit += (intensity / 1000) * effects.conduitOpening;
    }
    applied.add("RockResistance", i, rock);
    applied.add("FractureConductance", i, conduit);
  }
}

/**
 * The meetings' own processes on the ground, scaled by their coverage (ADR 0007), read from
 * the engine's confluence states: fractures, rock, a bounded signed roughening of the relief
 * with a fixed per-cell hash, soil removal, coastal forcing and ice melt as declared totals;
 * fog and toxicity as maxima.
 */
export function declareConfluenceWrites(state: RegionalState, seed: number) {
  const map = state.physical.map,
    mesh = map.mesh,
    applied = state.regional.contributions,
    soil = naturalBand(state, "SoilDepth"),
    toxicity = naturalBand(state, "EcologicalToxicity");
  // Toxicity re-forms from the captured value each evaluation; a meeting that moved leaves none.
  for (let i = 0; i < mesh.count; i++)
    if (isContent(mesh, i)) map.EcologicalToxicity.set(i, toxicity.get(i));
  for (const held of Object.values(state.physical.magic!.confluences.states)) {
    const e = held.definition.effects,
      salt = seed ^ 0x51f7 ^ held.definition.id.length;
    for (let i = 0; i < mesh.count; i++) {
      const c = held.coverage.get(i);
      if (c <= 0 || !isContent(mesh, i)) continue;
      applied.add("FractureConductance", i, e.fractureConductance * c);
      applied.add("RockResistance", i, e.rockResistance * c);
      applied.add("Elevation", i, units(e.relief * c * (hashUnit(salt, i, 0) * 2 - 1)));
      applied.add("SoilDepth", i, -soil.get(i) * e.soilRemoval * c);
      if (map.WaterKindCodes.get(i) === 0)
        applied.add("ExternalCoastalForcing", i, e.coastalForcing * c);
      applied.add("IceThickness", i, -e.iceMelt * c);
      if (e.fog) map.FogForcing.set(i, Math.max(map.FogForcing.get(i), e.fog * c));
      if (e.toxicity)
        map.EcologicalToxicity.set(i, Math.max(map.EcologicalToxicity.get(i), e.toxicity * c));
    }
  }
}

/** Hallowed: the first unwarded reach below a ward loses the resistance the ring gained. */
export function declareHallowedWrites(state: RegionalState) {
  const map = state.physical.map,
    applied = state.regional.contributions;
  for (const field of enabledFields(state)) {
    if (field.definition.effects.warding <= 0) continue;
    const spill = field.definition.parameters.wardSpill;
    for (let i = 0; i < map.mesh.count; i++) {
      const w = map.Warding.get(i),
        target = map.FlowTargets.get(i);
      if (w <= 0 || target < 0 || map.Warding.get(target) > 0) continue;
      if (map.WaterKindCodes.get(target) !== 0) continue;
      applied.add("RockResistance", target, -spill * w);
    }
  }
}

/**
 * Veil: wild ground's relief as a declared total with a fixed per-cell hash (so wild zones
 * move with the field instead of ratcheting). A door's own marks are the door entry's.
 */
export function declareVeilWrites(state: RegionalState) {
  for (const field of enabledFields(state))
    if (field.definition.parameters.wildRelief) declareWildRelief(state, field);
}
function declareWildRelief(state: RegionalState, field: MagicField) {
  const map = state.physical.map,
    mesh = map.mesh,
    applied = state.regional.contributions,
    relief = field.definition.parameters.wildRelief;
  for (let i = 0; i < mesh.count; i++) {
    const w = field.wild.get(i);
    if (w <= 0 || !isContent(mesh, i) || map.WaterKindCodes.get(i) !== 0) continue;
    applied.add("Elevation", i, units(relief * w * 2 * (hashUnit(0x7e11, i, 0) - 0.5)));
  }
}

/**
 * Salt: the ground fuses to glass where the bed is deep (declared resistance, the soil gone),
 * salted ground draws the air's moisture down, and Fire burns the stocks by its quickening
 * once (the first round): the regional burn is not counted again each round.
 */
export function declareSaltWrites(state: RegionalState, burn: boolean) {
  const map = state.physical.map,
    mesh = map.mesh,
    applied = state.regional.contributions,
    fields = enabledFields(state),
    salts = fields.filter((field) => field.definition.effects.salting > 0),
    fire = fields.find((field) => field.definition.effects.quickening > 0),
    // Totals are declared against the captured ground, never against the band as last written.
    soil = naturalBand(state, "SoilDepth"),
    moisture = naturalBand(state, "Moisture");
  for (const field of salts) {
    const p = field.definition.parameters;
    for (let i = 0; i < mesh.count; i++) {
      if (!isContent(mesh, i) || map.WaterKindCodes.get(i) !== 0) continue;
      if (reservoirAmount(field, "bed", i) / mesh.contentArea(i) >= p.glassBed) {
        applied.add("RockResistance", i, p.glassResistance);
        applied.add("SoilDepth", i, -soil.get(i));
      }
      const salting = (field.intensity.get(i) / 1000) * field.definition.effects.salting;
      if (salting > 0) applied.add("Moisture", i, -moisture.get(i) * p.desiccation * salting);
      if (burn && fire && fire.intensity.get(i) > 0) burnSalt(field, fire, i, p.saltBurn);
    }
  }
}
function burnSalt(field: MagicField, fire: MagicField, i: number, saltBurn: number) {
  const share = clamp(saltBurn * (fire.intensity.get(i) / 1000));
  for (const values of Object.values(field.stocks)) {
    const held = values.get(i);
    values.set(i, held * (1 - share));
    field.lost += held * share;
  }
}

/**
 * Charge holds ice: the persistence each system's held charge gives, as the engine gates it
 * on intensity, written each round for the ice budget to read (the world's history-based
 * hold is an epoch's; a round is not).
 */
export function holdIce(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    fields = enabledFields(state).filter((field) => field.definition.effects.icePersistence > 0);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    let persistence = 0;
    for (const field of fields) {
      // The engine's held charge (strength gated by ice present), with a strong captured
      // field's relict share as the floor: charge in the ground keeps acting before ice stands.
      const relict = field.definition.parameters.relictStrength,
        strength = clamp((field.intensity.get(i) - 600) / 300),
        held = Math.max(heldCharge(map, field, i), strength * relict);
      persistence = Math.max(persistence, field.definition.effects.icePersistence * held);
    }
    map.IcePersistence.set(i, persistence);
  }
}

/** The cell of a position on this frame, or -1 outside it. */
export const frameCell = (state: RegionalState) => (x: number, y: number) => {
  const mesh = state.physical.map.mesh,
    cell = cellAt(mesh, x, y);
  return cell >= 0 && isContent(mesh, cell) ? cell : -1;
};
/**
 * A captured door of one system as cells of this frame: the record's two stored ends, or one
 * end when the far end lies outside the frame (a one-ended access), or null when neither end
 * lands here or the record is no such door. A building's door has no system or rule behind it.
 */
export function capturedDoor(
  feature: AtlasFeature,
  system: string,
  cellOf: (x: number, y: number) => number
): { a: number; b: number } | null {
  const ends = capturedDoorEnds(feature, system).map(([x, y]) => cellOf(x, y)),
    [a = -1, b = a] = ends;
  if (a < 0 && b < 0) return null;
  return { a: a >= 0 ? a : b, b: b >= 0 ? b : a };
}
/**
 * The ends a captured door's record stores, none when it is no door of this system. A record an
 * earlier refinement moved keeps the parent's in its captured record; this map's own products
 * are regenerated, not read.
 */
function capturedDoorEnds(feature: AtlasFeature, system: string) {
  if (feature.attributes.developedBy === "regional") return [];
  const parent = feature.attributes.capturedRecord as AtlasFeature | undefined,
    record = parent?.attributes ?? feature.attributes;
  return record.system === system && record.rule === "door"
    ? ((record.ends ?? []) as number[][])
    : [];
}
/** Doors from the captured records. The engine's pairing keeps them while both ends qualify. */
export function seedDoors(state: RegionalState, field: MagicField) {
  const seeded: { a: number; b: number }[] = [],
    cellOf = frameCell(state);
  for (const feature of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    const door = capturedDoor(feature, field.definition.id, cellOf);
    if (!door) continue;
    field.doors.push(door);
    seeded.push(door);
  }
  return seeded;
}

/**
 * The captured field continues beyond the frame (X1): along the frame edge the captured
 * intensity stands as a floor, fading inward over a parent span, so a field the parent
 * carries across the frame does not end at the edge for lack of a source inside.
 */
export function edgeFloor(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    span = regionalSpan(state),
    reach = Math.max(1, Math.round(state.regional.parentSpan / span)),
    steps = new Int32Array(mesh.count).fill(-1),
    queue = edgeCells(state),
    around = new Int32Array(mesh.stride);
  for (const i of queue) steps[i] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (steps[i] >= reach) continue;
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (steps[j] >= 0 || !isContent(mesh, j)) continue;
      steps[j] = steps[i] + 1;
      queue.push(j);
    }
  }
  const floor = new Float64Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) if (steps[i] >= 0) floor[i] = 1 - steps[i] / reach;
  return floor;
}

/** The content cells on the frame edge. */
function edgeCells(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i) && frameEdge(mesh, i)) cells.push(i);
  return cells;
}

const enabledFields = (state: RegionalState) =>
  (state.physical.magic?.fields ?? []).filter((field) => field.definition.enabled);
