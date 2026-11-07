import type { Band } from "@atlas/domain";
import type { PhysicalContext } from "../world/context";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { retainedArray } from "../world/physicalNumerics";

/**
 * A question a process asks of the world, named for what it wants to know and not for where the answer
 * lives. Whoever has something to say about it responds, in their own terms; the asker never learns who.
 */
export const answerKeys = [
  /** The water each cell sends downstream, against the reference runoff. */
  "discharge",
  /** How wet the ground stays. */
  "wetness",
  /** How warm the ground's air is, above freezing. */
  "warmth",
  /** How often the ground crosses freezing with water to freeze. */
  "frost",
  /** How hard sliding ice bites its bed, against plain ice's 1. */
  "iceBite",
  /** The energy of the waves on a cell of open water, on the field's 0 to 1000 scale. */
  "waveEnergy",
  /** Worn ground fed to the water on a cell this pass, in height units. */
  "looseSupply",
  /** What a unit of water carries on this ground, per unit of span. */
  "loadCapacity",
  /** How far roots bind the ground, as a share added to bare ground's hold. */
  "rootHold",
  /** How hot buried rock gets here, as a share of full metamorphic heat. */
  "heat",
] as const;
export type AnswerKey = (typeof answerKeys)[number];

interface ResponderBase {
  readonly key: AnswerKey;
  /** Who is answering: what the coupling table and a cell's trace name. */
  readonly by: string;
  /** What it needs from the field to answer. */
  readonly reads: readonly PhysicalBufferName[];
}
/** The first answer to a key: one responder states it, and the rest change it. */
export interface BaseResponder extends ResponderBase {
  readonly base: (map: PhysicalField, i: number, context: PhysicalContext) => number;
}
export interface AddingResponder extends ResponderBase {
  readonly add: (map: PhysicalField, i: number, context: PhysicalContext) => number;
}
export interface ScalingResponder extends ResponderBase {
  readonly scale: (map: PhysicalField, i: number, context: PhysicalContext) => number;
}
export type Responder = BaseResponder | AddingResponder | ScalingResponder;

const registered = new Map<AnswerKey, Responder[]>(answerKeys.map((key) => [key, []]));

/** A responder joins a key. It edits no one who asks. */
export function respond(responder: Responder) {
  const all = registered.get(responder.key)!;
  if ("base" in responder && all.some((other) => "base" in other))
    throw new Error(`${responder.key} already has a base answer.`);
  all.push(responder);
}
export const respondersTo = (key: AnswerKey): readonly Responder[] => registered.get(key)!;

interface Memo {
  band: Band;
  revision: number;
}
interface Answers {
  revision: number;
  memos: Map<AnswerKey, Memo>;
}
const answersOf = new WeakMap<PhysicalField, Answers>();
function state(map: PhysicalField) {
  let held = answersOf.get(map);
  if (!held) answersOf.set(map, (held = { revision: 0, memos: new Map() }));
  return held;
}
/** The world has moved on: what was answered no longer stands. */
export function worldMoved(map: PhysicalField) {
  state(map).revision++;
}
function compute(map: PhysicalField, key: AnswerKey, context: PhysicalContext, band: Band) {
  const all = registered.get(key)!,
    base = all.find((one): one is BaseResponder => "base" in one);
  if (!base) throw new Error(`Nothing answers ${key}.`);
  const adding = all.filter((one): one is AddingResponder => "add" in one),
    scaling = all.filter((one): one is ScalingResponder => "scale" in one);
  for (let i = 0; i < map.mesh.count; i++) {
    let value = base.base(map, i, context);
    for (const one of adding) value += one.add(map, i, context);
    for (const one of scaling) value *= one.scale(map, i, context);
    band.set(i, value);
  }
}
/**
 * The answer to a key across the map, resolved once into a band and held until the next step begins,
 * so a hot loop reads an array. Within a step the answer stands as the step found the world.
 */
export function ask(map: PhysicalField, key: AnswerKey, context: PhysicalContext): Band {
  const held = state(map);
  let memo = held.memos.get(key);
  if (!memo) {
    memo = { band: retainedArray(map, "float64", `answer:${key}`), revision: -1 };
    held.memos.set(key, memo);
  }
  if (memo.revision !== held.revision) {
    compute(map, key, context, memo.band);
    memo.revision = held.revision;
  }
  return memo.band;
}
