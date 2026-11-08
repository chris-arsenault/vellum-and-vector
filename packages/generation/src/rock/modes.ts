import {
  baselineRock,
  rockCodeCount,
  rockKindIds,
  rockCatalogue,
  type ModeId,
  type RockFacts,
  rockKindOfCode,
} from "./rockCatalogue";
import type { MaterialLayer } from "./rockColumn";

/**
 * The vocabulary between processes and materials: each mode is one way of attacking material. A
 * process says how it acts in modes and a material holds facts, so neither knows the other, and how
 * facts answer an attack belongs here. Add a mode only when a real process cannot act without it.
 */
export interface Mode {
  readonly id: ModeId;
  /** How far a material's facts open it to this attack, where ordinary rock is about 1. */
  readonly openness: (facts: RockFacts) => number;
  /** Whether strength resists this attack, or only the facts above do. */
  readonly strengthResists: boolean;
  /** How far living cover binds against it, as a share of its full hold. */
  readonly coverHolds: number;
  /** How far open fractures weaken against it, as a power of e at full fracture. */
  readonly fracturesWeaken: number;
  /** How far a full ward holds against it. */
  readonly wardHolds: number;
}
export const modes: Readonly<Record<ModeId, Mode>> = {
  // Grinding by what water or wind carries: strength is all, and roots hold the ground together.
  abrasion: {
    id: "abrasion",
    openness: () => 1,
    strengthResists: true,
    coverHolds: 1,
    fracturesWeaken: 0.5,
    wardHolds: 0.5,
  },
  // Blocks pulled out along joints: columnar basalt goes before massive gneiss. Roots are nothing to it.
  plucking: {
    id: "plucking",
    openness: ({ jointing }) => 0.5 + jointing / 0.6,
    strengthResists: true,
    coverHolds: 0,
    fracturesWeaken: 1,
    wardHolds: 0.5,
  },
  // A mass failing along what divides it: joints, and beds to a lesser degree.
  shear: {
    id: "shear",
    openness: ({ jointing, bedding }) => 0.5 + (0.5 * (jointing + 0.5 * bedding)) / 0.7,
    strengthResists: true,
    coverHolds: 1,
    fracturesWeaken: 0.5,
    wardHolds: 0.5,
  },
  // Dissolving: what the rock is made of decides, not how strong it is.
  solution: {
    id: "solution",
    openness: ({ solubility }) => solubility,
    strengthResists: false,
    coverHolds: 0,
    fracturesWeaken: 0.25,
    wardHolds: 0.5,
  },
};
export const modeIds = Object.keys(modes) as ModeId[];
/** How a process acts: each mode's share of what it does. */
export type ModeMix = Readonly<Partial<Record<ModeId, number>>>;
/** A mix resolved for every kind at load, so a cell reads two numbers and no rule runs per cell. */
export interface CompiledMix {
  readonly fabricResponse: number;
  /** What a kind gives up whatever its strength. */
  readonly flat: Float64Array;
  /** What it gives up in proportion to ordinary rock's strength over its own. */
  readonly byStrength: Float64Array;
  readonly coverHolds: number;
  readonly fracturesWeaken: number;
  readonly wardHolds: number;
}
export function compileMix(mix: ModeMix): CompiledMix {
  const flat = new Float64Array(rockCodeCount),
    byStrength = new Float64Array(rockCodeCount),
    weighted = (read: (mode: Mode) => number) =>
      modeIds.reduce((total, id) => total + (mix[id] ?? 0) * read(modes[id]), 0);
  for (const kindId of rockKindIds) {
    const kind = rockCatalogue[kindId];
    for (const id of modeIds) {
      const share = mix[id] ?? 0,
        stated = kind.gives?.[id];
      if (stated !== undefined) flat[kind.code] += share * stated;
      else if (modes[id].strengthResists) byStrength[kind.code] += share * modes[id].openness(kind);
      else flat[kind.code] += share * modes[id].openness(kind);
    }
  }
  return {
    fabricResponse: (mix.shear ?? 0) + 0.5 * (mix.plucking ?? 0),
    flat,
    byStrength,
    coverHolds: weighted((mode) => mode.coverHolds),
    fracturesWeaken: weighted((mode) => mode.fracturesWeaken),
    wardHolds: weighted((mode) => mode.wardHolds),
  };
}
/** What a kind of this code at this strength gives up to a mix, against ordinary rock's 1. */
export const givenUp = (mix: CompiledMix, code: number, strength: number) =>
  mix.flat[code] + (mix.byStrength[code] * baselineRock) / Math.max(1, strength);

/** Both retained constituents answer the action; damage belongs to this bed, not the next outcrop. */
export function materialGives(mix: CompiledMix, layer: MaterialLayer, loose = false, x = 0, y = 0) {
  const strength = loose
      ? Math.min(layer.strength, rockCatalogue.alluvium.resistance)
      : layer.strength,
    first = givenUp(mix, layer.kind, strength),
    second = givenUp(mix, layer.secondaryKind, strength);
  const length = x * x + y * y,
    alignment =
      length > 0
        ? ((x * x - y * y) * layer.grainX + 2 * x * y * layer.grainY) / (1000 * length)
        : 0,
    bedding =
      rockKindOfCode(layer.kind).bedding * (1 - layer.secondaryShare) +
      rockKindOfCode(layer.secondaryKind).bedding * layer.secondaryShare;
  return (
    (1 + 0.5 * mix.fabricResponse * bedding * alignment) *
    ((first + (second - first) * layer.secondaryShare) *
      Math.exp(mix.fracturesWeaken * layer.damage))
  );
}
/** Burial consolidates the deposited components; it does not choose rock from today's climate. */
export function burialResponse(layer: MaterialLayer, epoch: number): MaterialLayer {
  const consolidate = (code: number) => {
      const kind = rockKindOfCode(code);
      return kind.family === "loose" ? rockCatalogue.sandstone : kind;
    },
    first = consolidate(layer.kind),
    second = consolidate(layer.secondaryKind);
  return {
    ...layer,
    kind: first.code,
    secondaryKind: second.code,
    strength:
      first.resistance * (1 - layer.secondaryShare) + second.resistance * layer.secondaryShare,
    damage: layer.damage * 0.5,
    altered: epoch,
  };
}
/** Heat transforms retained constituents independently; unrelated later beds inherit no alteration. */
export function heatedMaterial(layer: MaterialLayer, epoch: number): MaterialLayer {
  const heat = (code: number) => {
      const kind = rockKindOfCode(code);
      return kind.underHeat ? rockCatalogue[kind.underHeat] : kind;
    },
    first = heat(layer.kind),
    second = heat(layer.secondaryKind);
  if (first.code === layer.kind && second.code === layer.secondaryKind) return layer;
  return {
    ...layer,
    kind: first.code,
    secondaryKind: second.code,
    strength:
      first.resistance * (1 - layer.secondaryShare) + second.resistance * layer.secondaryShare,
    damage: layer.damage * 0.5,
    altered: epoch,
  };
}
