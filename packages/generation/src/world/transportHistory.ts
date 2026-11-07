import { physicalSchema, type PhysicalBufferName, type PhysicalField } from "./field";
import { clamp } from "./math";
import { weightScale, type TransportPlan } from "./transportPlan";
import { captureCrustColumns, transportCrustColumns } from "./crustTransport";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import {
  freshCrustValue,
  transportRules,
  identityRules,
  quantityKinds,
  returnPools,
  type TransportAnswer,
  type IdentityRule,
} from "../coupling/quantities";
import { carryOut } from "../rock/groundLedger";

/**
 * A plate move is one history event for every quantity at once, and each answers it by its kind, as
 * `transportRules` sets out: nothing here names a band. A quantity moves with the crust because it is
 * declared, and an identity with a rule of its own picks its arrival by that rule.
 */
const schema = new Map(physicalSchema().map((entry) => [entry.name as string, entry]));
const answering = (name: string) => transportRules[quantityKinds[name]];
const bandsAnswering = (answer: TransportAnswer) =>
  Object.keys(quantityKinds).filter(
    (name) => answering(name).moved === answer
  ) as PhysicalBufferName[];
const ruled = Object.keys(identityRules) as PhysicalBufferName[];
const dominant = bandsAnswering("dominant").filter((name) => !identityRules[name]);

/** Each source's scatter, accumulated over its targets: summed by area, or the largest arriving. */
function accumulate(
  map: PhysicalField,
  plan: TransportPlan,
  name: PhysicalBufferName,
  scratch: Band,
  areaWeights?: Band
) {
  scratch.fill(0);
  const values = map[name];
  for (let source = 0; source < map.mesh.count; source++) {
    const value = values.get(source),
      end = plan.offsets.get(source + 1);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset);
      if (target < 0) continue;
      if (areaWeights) scratch.add(target, value * areaWeights.get(offset));
      else scratch.set(target, Math.max(scratch.get(target), value));
    }
  }
}
/** What a cell holds once everything has arrived, by what its quantity answers each event. */
function arrived(name: PhysicalBufferName, sum: number, arrival: number, boundary: number) {
  const rules = answering(name),
    fresh = rules.newCrust === "fresh" ? freshCrustValue(name) : 0;
  if (arrival <= 0) return fresh;
  if (rules.moved === "sum") return sum / weightScale;
  if (rules.rifted === "blend" && boundary === 2 && arrival < weightScale)
    return (sum + fresh * (weightScale - arrival)) / weightScale;
  return sum / arrival;
}
/** A whole-number band holds only what its storage can. */
const stored = (name: PhysicalBufferName, value: number) =>
  schema.get(name)?.type === "int32" ? clamp(value, -2147483648, 2147483647) : value;
function complete(
  map: PhysicalField,
  plan: TransportPlan,
  name: PhysicalBufferName,
  scratch: Band
) {
  const values = map[name];
  for (let target = 0; target < map.mesh.count; target++) {
    const value = arrived(
      name,
      scratch.get(target),
      plan.arrivals.get(target),
      map.TectonicBoundaryCodes.get(target)
    );
    values.set(target, stored(name, value));
  }
}
interface Picking {
  name: PhysicalBufferName;
  rule: IdentityRule;
  value: Band;
  held: Band;
}
function picking(map: PhysicalField): Picking[] {
  return ruled.map((name) => ({
    name,
    rule: identityRules[name]!,
    value: workingArray(map, "float64", `transport:${name}`).fill(schema.get(name)!.initial),
    held: workingArray(map, "float64", `transport:held:${name}`).fill(0),
  }));
}
/** One arrival offered to an identity with a rule of its own. */
function offer(map: PhysicalField, p: Picking, source: number, target: number, weight: number) {
  const id = map[p.name].get(source),
    { pick, least = 0 } = p.rule;
  if (weight < least * weightScale) return;
  if (pick === "every") p.value.set(target, p.value.get(target) | id);
  else if (pick === "latest") p.value.set(target, Math.max(p.value.get(target), id));
  else offerHeaviest(map, p, source, target, weight);
}
/** The arrival bringing most of what it is weighed by takes the cell; a tie goes to the lower id. */
function offerHeaviest(
  map: PhysicalField,
  p: Picking,
  source: number,
  target: number,
  weight: number
) {
  const id = map[p.name].get(source),
    weighBy = p.rule.weighBy,
    by = weighBy ? map[weighBy].get(source) : 1,
    contribution = weight * by,
    held = p.held.get(target);
  if (weighBy && (id <= 0 || by <= 0)) return;
  if (contribution < held || (contribution === held && held > 0 && id >= p.value.get(target)))
    return;
  p.value.set(target, id);
  p.held.set(target, contribution);
}
/** An identity holds while what it stands for stands; otherwise it goes, or clears what it says. */
function settlePick(map: PhysicalField, p: Picking, target: number) {
  const { heldWhile, clears } = p.rule,
    value = p.value.get(target),
    holds = !heldWhile || map[heldWhile].get(target) > 0;
  if (holds) map[p.name].set(target, value);
  else if (clears) map[p.name].set(target, value & ~clears);
  else map[p.name].set(target, schema.get(p.name)!.initial);
}
/** What sinks with the crust: lost with it, or back to its pool where it is material on its way. */
function sinking(map: PhysicalField, source: number, retained: number) {
  for (const [name, pool] of Object.entries(returnPools)) {
    const lost = Math.max(0, 1 - retained) * map[name as PhysicalBufferName].get(source);
    if (pool === "sea" && lost > 0) carryOut(map, (lost * map.mesh.area(source)) / 1024, "plates");
  }
}
function scatter(map: PhysicalField, plan: TransportPlan, picks: Picking[], areaWeights: Band) {
  for (let source = 0; source < map.mesh.count; source++) {
    let retained = 0;
    const end = plan.offsets.get(source + 1);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset),
        weight = plan.weights.get(offset);
      if (target < 0) continue;
      areaWeights.set(offset, (weight * map.mesh.area(source)) / map.mesh.area(target));
      for (const p of picks) offer(map, p, source, target, weight);
      retained += weight / weightScale;
    }
    sinking(map, source, retained);
  }
}
export function transportHistory(map: PhysicalField, plan: TransportPlan) {
  const crust = captureCrustColumns(map),
    picks = picking(map),
    scratch = workingArray(map, "float64", "transport:channel"),
    areaWeights = workingArray(map, "float64", "transport:areaWeights", plan.weights.length),
    kinds = dominant.map((name) => map.coverage.copyBand(map[name]));
  // Identities pick from their sources before what they weigh by moves in place.
  scatter(map, plan, picks, areaWeights);
  for (const name of [...bandsAnswering("mean"), ...bandsAnswering("sum")]) {
    accumulate(map, plan, name, scratch, areaWeights);
    complete(map, plan, name, scratch);
  }
  for (const name of bandsAnswering("largest")) {
    accumulate(map, plan, name, scratch);
    map[name].copyFrom(scratch);
  }
  transportCrustColumns(map, plan, crust);
  for (let target = 0; target < map.mesh.count; target++) {
    for (const p of picks) settlePick(map, p, target);
    const source = plan.dominant.get(target);
    // A kind is not an amount: a cell takes it from whatever crust mostly arrived there.
    dominant.forEach((name, n) => map[name].set(target, source >= 0 ? kinds[n].get(source) : 0));
  }
  releaseWorking(
    map,
    ...Object.values(crust),
    ...picks.flatMap((p) => [p.value, p.held]),
    scratch,
    areaWeights,
    ...kinds
  );
}
