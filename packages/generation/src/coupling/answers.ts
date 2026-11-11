import type { Band } from "@atlas/domain";
import { processRevision, readOperation } from "../processOperation";
import type { PhysicalQuery } from "../processes/groundProcess";
import type { PhysicalContext } from "../world/context";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { retainedArray } from "../world/physicalNumerics";

/**
 * A question a process asks of the world, named for what it wants to know and not for where the answer
 * lives. Whoever has something to say about it responds, in their own terms; the asker never learns who.
 */
export const answerKeys = [
  /** Local surface-water supply, in millimetres per year, composed by its current owners. */
  "surfaceWater",
  /** Maintained channel intake, in cubic metres per second. */
  "waterWithdrawal",
  /** Fraction of received water passing a cell after its withdrawals. */
  "waterTransmission",
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
  /** External wave forcing received by the current dry shore, on the 0 to 1000 scale. */
  "coastalForcing",
  /** Worn ground fed to the water on a cell this pass, in height units. */
  "looseSupply",
  /** What a unit of water carries on this ground, per unit of span. */
  "loadCapacity",
  /** How far roots bind the ground, as a share added to bare ground's hold. */
  "rootHold",
  /** How hot buried rock gets here, as a share of full metamorphic heat. */
  "heat",
  /** The height the sea stands at over this cell, in the field's own height units. */
  "seaStand",
  /** How good the year is for growing on this ground, from nothing to the best there is. */
  "season",
  /** People a square kilometre of this ground feeds under crops, under herds and left wild. */
  "cropYield",
  "herdYield",
  "wildYield",
  /** People a square kilometre of this ground feeds as its area is used now. */
  "support",
  /** The cost of crossing a metre of this ground, against a metre of open level ground. */
  "travelFriction",
  /** How far the ground's height holds against whoever climbs it, against the usual 1. */
  "climbing",
  /** The share of what hunger, a hazard or an attack would take from people's layers that it takes. */
  "harm",
  /** The share of a cell's people who are free to follow the pull of other people. */
  "moving",
  /** The share of those who stay on a cell who build where they stay. */
  "building",
  /** How fast what people leave on the ground and in each other fades, against the usual rate. */
  "forgetting",
  /** How readily people who hold with one realm come to hold with another, against the usual. */
  "yielding",
  /** The people per square kilometre who count as being on a cell. */
  "presence",
] as const;
export type AnswerKey = (typeof answerKeys)[number];
type CellAnswer = (key: AnswerKey) => number;
type Response = (
  map: PhysicalField,
  i: number,
  context: PhysicalContext,
  answer: CellAnswer
) => number;

interface ResponderBase {
  readonly key: AnswerKey;
  /** Who is answering, as named by explainAnswer. */
  readonly by: string;
  /** What it needs from the field to answer. */
  readonly reads: readonly PhysicalBufferName[];
  /** Other composed quantities needed before this answer's hot loop. */
  readonly answers?: readonly AnswerKey[];
  readonly queries?: readonly PhysicalQuery[];
}
/** The first answer to a key: one responder states it, and the rest change it. */
export interface BaseResponder extends ResponderBase {
  readonly base: Response;
}
export interface AddingResponder extends ResponderBase {
  readonly add: Response;
}
export interface ScalingResponder extends ResponderBase {
  readonly scale: Response;
}
/**
 * A break: over the share of a cell the breaker holds, the answer is the breaker's own and
 * everything else said about the key is set aside. The rule still holds on the rest of the
 * cell. Breaks apply in the order their responders joined, each over what the last left.
 */
export interface BreakingResponder extends ResponderBase {
  /** The share of the cell, 0 to 1, on which the rule does not hold. */
  readonly share: Response;
  /** The answer on that share. */
  readonly instead: Response;
}
export type Responder = BaseResponder | AddingResponder | ScalingResponder | BreakingResponder;
const unit = (value: number) => (value > 0 ? Math.min(1, value) : 0);
/** One cell's answer after a break: the rule on the share it keeps, the breaker's on the rest. */
const broken = (value: number, share: number, instead: number) =>
  share > 0 ? value * (1 - share) + instead * share : value;

const registered = new Map<AnswerKey, Responder[]>(answerKeys.map((key) => [key, []]));

/** A responder joins a key. It edits no one who asks. */
export function respond(responder: Responder) {
  const all = registered.get(responder.key)!;
  if ("base" in responder && all.some((other) => "base" in other))
    throw new Error(`${responder.key} already has a base answer.`);
  all.push(responder);
}
export const respondersTo = (key: AnswerKey): readonly Responder[] => registered.get(key)!;

/** Evaluate one cell for inspection, without changing the cached answer or recording a history. */
export function explainAnswer(
  map: PhysicalField,
  key: AnswerKey,
  i: number,
  context: PhysicalContext
) {
  const responders = respondersTo(key);
  const answer: CellAnswer = (dependency) => explainAnswer(map, dependency, i, context).value;
  const contributions = responders.map((one) => {
    if ("base" in one)
      return { by: one.by, operation: "base" as const, value: one.base(map, i, context, answer) };
    if ("add" in one)
      return { by: one.by, operation: "add" as const, value: one.add(map, i, context, answer) };
    if ("scale" in one)
      return { by: one.by, operation: "scale" as const, value: one.scale(map, i, context, answer) };
    return {
      by: one.by,
      operation: "break" as const,
      value: one.instead(map, i, context, answer),
      share: unit(one.share(map, i, context, answer)),
    };
  });
  const base = contributions.find((one) => one.operation === "base");
  if (!base) throw new Error(`Nothing answers ${key}.`);
  let value = base.value;
  for (const one of contributions) if (one.operation === "add") value += one.value;
  for (const one of contributions) if (one.operation === "scale") value *= one.value;
  for (const one of contributions)
    if (one.operation === "break") value = broken(value, one.share, one.value);
  return { value, contributions };
}

interface Memo {
  band: Band;
  revision: number;
}
interface Answers {
  memos: Map<AnswerKey, Memo>;
}
const answersOf = new WeakMap<PhysicalField, Answers>();
/** Inspect the group's captured answers without evaluating a key or changing the cache. */
export function capturedAnswersAt(map: PhysicalField, cell: number) {
  const held = answersOf.get(map),
    values: Partial<Record<AnswerKey, number>> = {};
  if (!held) return values;
  for (const [key, memo] of held.memos)
    if (memo.revision === processRevision(map)) values[key] = memo.band.get(cell);
  return values;
}
function state(map: PhysicalField) {
  let held = answersOf.get(map);
  if (!held) answersOf.set(map, (held = { memos: new Map() }));
  return held;
}
function compute(map: PhysicalField, key: AnswerKey, context: PhysicalContext, band: Band) {
  const all = registered.get(key)!,
    base = all.find((one): one is BaseResponder => "base" in one);
  if (!base) throw new Error(`Nothing answers ${key}.`);
  const adding = all.filter((one): one is AddingResponder => "add" in one),
    scaling = all.filter((one): one is ScalingResponder => "scale" in one),
    breaking = all.filter((one): one is BreakingResponder => "share" in one);
  let i = 0;
  const answer: CellAnswer = (dependency) => ask(map, dependency, context).get(i);
  for (; i < map.mesh.count; i++) {
    let value = base.base(map, i, context, answer);
    for (const one of adding) value += one.add(map, i, context, answer);
    for (const one of scaling) value *= one.scale(map, i, context, answer);
    for (const one of breaking) {
      const share = unit(one.share(map, i, context, answer));
      if (share > 0) value = broken(value, share, one.instead(map, i, context, answer));
    }
    band.set(i, value);
  }
}
/**
 * Resolve a key into a band for hot-loop reads. The driver refreshes answers at each process or
 * simultaneous substep; a group's declared questions are resolved before any participant runs.
 */
export function ask(map: PhysicalField, key: AnswerKey, context: PhysicalContext): Band {
  const held = state(map);
  let memo = held.memos.get(key);
  if (!memo) {
    memo = { band: retainedArray(map, "float64", `answer:${key}`), revision: -1 };
    held.memos.set(key, memo);
  }
  if (memo.revision !== processRevision(map)) {
    for (const responder of respondersTo(key)) {
      for (const dependency of responder.queries ?? [])
        readOperation(map, dependency, { map, context });
      for (const dependency of responder.answers ?? []) ask(map, dependency, context);
    }
    compute(map, key, context, memo.band);
    memo.revision = processRevision(map);
  }
  return memo.band;
}
