import {
  confluenceEffective,
  type ConfluenceEffects,
  type MagicConfluence,
  type MagicFeatureRule,
  type MagicSystem,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { growRegion } from "./magicRegions";
import { clamp, rockResistance, round, units } from "./math";
import { hashUnit } from "./noise";
import { deposit, rebuild } from "./surface";

/** A confluence's hold on the mesh this evaluation: where it holds and how much of each cell. */
export interface ConfluenceState {
  definition: MagicConfluence;
  members: Uint8Array;
  coverage: Float64Array;
}
export interface ConfluenceWorkspace {
  definitions: MagicConfluence[];
  states: Record<string, ConfluenceState>;
  /** Strain between systems per cell, 0–1: the product of two intensities times their front. */
  strain: Float64Array;
}
export function createConfluenceWorkspace(
  definitions: MagicConfluence[],
  count: number
): ConfluenceWorkspace {
  return { definitions, states: {}, strain: new Float64Array(count) };
}

/** Every meeting whose systems are all present and enabled, in list order. */
export function activeConfluences(state: GenerationState) {
  const magic = state.physical!.magic!,
    systems = magic.fields.map((field) => field.definition);
  return magic.confluences.definitions.filter((confluence) =>
    confluenceEffective(confluence, systems)
  );
}
function participants(state: GenerationState, confluence: MagicConfluence) {
  const fields = state.physical!.magic!.fields;
  return confluence.systems.map((id) => fields.find((field) => field.definition.id === id)!);
}
/**
 * Strain between two fields in a cell: how strong both are and how sharply their gap turns
 * across the cell's edges. A smooth overlap strains little; a front strains much.
 */
export function strainAt(map: PhysicalField, a: MagicField, b: MagicField, i: number) {
  const gap = (a.intensity[i] - b.intensity[i]) / 1000;
  let front = 0;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j < 0) continue;
    front = Math.max(front, Math.abs(gap - (a.intensity[j] - b.intensity[j]) / 1000));
  }
  return (a.intensity[i] / 1000) * (b.intensity[i] / 1000) * front;
}
/**
 * Evaluate every active confluence from the systems' current fields and coverage: grow its
 * region from its conditions, take coverage from the parents where each reaches the floor,
 * displace the parents, bound every cell's coverages at one, and optionally act on the
 * ground. Systems' rule coverage must be current (see `coverSystems`).
 */
export function evaluateConfluences(state: GenerationState, seed: number, apply: boolean) {
  const work = state.physical!,
    map = work.map,
    magic = work.magic!,
    count = map.mesh.count;
  magic.confluences.states = {};
  magic.confluences.strain.fill(0);
  for (const confluence of activeConfluences(state)) {
    const fields = participants(state, confluence),
      rule = confluence as unknown as MagicFeatureRule,
      members = growRegion(state, fields[0], rule, seed),
      coverage = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      if (!members[i]) continue;
      if (fields.some((field) => field.systemCoverage[i] < confluence.floor)) {
        members[i] = 0;
        continue;
      }
      const strain = strainAt(map, fields[0], fields[1], i);
      magic.confluences.strain[i] = Math.max(magic.confluences.strain[i], strain);
      const parents = Math.min(...fields.map((field) => field.systemCoverage[i]));
      coverage[i] = parents * clamp(0.25 + strain * confluence.strainScale, 0, 1);
      for (const field of fields) displace(field, i, coverage[i]);
    }
    magic.confluences.states[confluence.id] = { definition: confluence, members, coverage };
  }
  boundCoverage(magic.fields, Object.values(magic.confluences.states), count);
  if (apply)
    for (const held of Object.values(magic.confluences.states)) applyConfluence(state, held, seed);
}
/** A meeting takes its coverage out of the parent's classes in the cell. */
function displace(field: MagicField, i: number, taken: number) {
  const remaining = Math.max(0, 1 - taken);
  for (const values of Object.values(field.coverage)) values[i] *= remaining;
  field.systemCoverage[i] *= remaining;
}
/** The coverages of all systems and meetings in a cell sum to at most one. */
function boundCoverage(fields: MagicField[], states: ConfluenceState[], count: number) {
  for (let i = 0; i < count; i++) {
    let total = 0;
    for (const field of fields) total += field.systemCoverage[i];
    for (const held of states) total += held.coverage[i];
    if (total <= 1) continue;
    const scale = 1 / total;
    for (const field of fields) {
      field.systemCoverage[i] *= scale;
      for (const values of Object.values(field.coverage)) values[i] *= scale;
    }
    for (const held of states) held.coverage[i] *= scale;
  }
}
/** The meeting's own process on the ground, scaled by its coverage in each cell. */
function applyConfluence(state: GenerationState, held: ConfluenceState, seed: number) {
  const map = state.physical!.map,
    e = held.definition.effects,
    salt = seed ^ 0x51f7 ^ held.definition.id.length;
  for (let i = 0; i < map.mesh.count; i++) {
    const c = held.coverage[i];
    if (c <= 0) continue;
    actOnRock(map, i, c, e, salt);
    actOnWaterAndLife(map, i, c, e);
  }
}
/** Fractures, rock, bedrock relief and soil: the meeting's geology. */
function actOnRock(map: PhysicalField, i: number, c: number, e: ConfluenceEffects, salt: number) {
  if (e.fractureConductance)
    map.FractureConductance[i] = clamp(
      map.FractureConductance[i] + round(e.fractureConductance * c),
      0,
      1000
    );
  if (e.rockResistance)
    map.RockResistance[i] = rockResistance(map.RockResistance[i] + round(e.rockResistance * c));
  if (e.relief) {
    // Bounded, signed roughening of the bedrock: needle fields, not a new range.
    const sign = hashUnit(salt, i, 0) * 2 - 1;
    map.BedrockElevation[i] += units(e.relief * c * sign);
    rebuild(map, i);
  }
  if (e.soilRemoval) {
    map.SoilDepth[i] *= 1 - e.soilRemoval * c;
    map.SoilWater[i] *= 1 - e.soilRemoval * c;
  }
}
/** Coast, fog, ice, debris and toxicity: the meeting's water and living medium. */
function actOnWaterAndLife(map: PhysicalField, i: number, c: number, e: ConfluenceEffects) {
  if (e.coastalForcing)
    map.ExternalCoastalForcing[i] = clamp(
      map.ExternalCoastalForcing[i] + round(e.coastalForcing * c),
      0,
      1000
    );
  if (e.fog) map.FogForcing[i] = Math.max(map.FogForcing[i], e.fog * c);
  if (e.iceMelt) map.IceThickness[i] = Math.max(0, map.IceThickness[i] - e.iceMelt * c);
  if (e.debris) collapseDebris(map, i, units(e.debris * c));
  if (e.toxicity) map.EcologicalToxicity[i] = Math.max(map.EcologicalToxicity[i], e.toxicity * c);
}
/**
 * Collapse debris is the cell's own rock broken where it lies: the bedrock surface drops by
 * the depth and the same depth of sediment covers it, so the sediment budget gains what it
 * deposits and the elevation stands.
 */
function collapseDebris(map: PhysicalField, i: number, depth: number) {
  if (depth <= 0) return;
  map.BedrockElevation[i] -= depth;
  map.SurfaceRockLoad[i] -= depth;
  map.SedimentProducedTotal += (depth / 1024) * map.mesh.areas[i];
  deposit(map, i, depth);
}
export type ConfluenceSystems = Pick<MagicSystem, "id" | "enabled">[];
