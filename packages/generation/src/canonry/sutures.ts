// ContinentalSutureLayer.cs, Canonry 0f62584c: transported material, not site labels.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round } from "./math";
import { KeyedHeap, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

interface Contact {
  pair: number;
  proximity: number;
}
class MaterialSearch {
  first = 0;
  second = 0;
  firstDistance = Infinity;
  secondDistance = Infinity;
  observe(map: PhysicalField, context: PhysicalContext, i: number, distance: number) {
    const assembly = map.CrustAssemblyIds.get(i);
    if (
      assembly <= 0 ||
      map.CrustContinentalFraction.get(i) < context.Profile.ContinentalSutureMinimumFraction
    )
      return;
    if (this.first === 0 || (assembly === this.first && distance < this.firstDistance)) {
      this.first = assembly;
      this.firstDistance = Math.min(this.firstDistance, distance);
      return;
    }
    if (
      assembly !== this.first &&
      (this.second === 0 || (assembly === this.second && distance < this.secondDistance))
    ) {
      this.second = assembly;
      this.secondDistance = Math.min(this.secondDistance, distance);
    }
  }
  contact(reach: number): Contact | null {
    if (this.first <= 0 || this.second <= 0) return null;
    return {
      pair: (Math.min(this.first, this.second) << 16) | Math.max(this.first, this.second),
      proximity: clamp(
        1 - Math.max(this.firstDistance, this.secondDistance) / Math.max(1, reach + 1),
        0,
        1
      ),
    };
  }
}
function findContact(
  map: PhysicalField,
  context: PhysicalContext,
  start: number,
  visited: Band,
  distance: Band,
  visit: number
): Contact | null {
  const p = context.Profile;
  const queue = new KeyedHeap("min");
  const search = new MaterialSearch();
  visited.set(start, visit);
  distance.set(start, 0);
  queue.push(start, 0);
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const d = queue.poppedKey();
    if (d !== distance.get(i)) continue;
    search.observe(map, context, i, d);
    const contact = search.contact(p.ContinentalSutureDetectionReach);
    if (contact) return contact;
    if (d >= p.ContinentalSutureDetectionReach) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      const next = d + map.mesh.edgeLength(i, edge);
      if (j < 0 || next > p.ContinentalSutureDetectionReach) continue;
      if (visited.get(j) === visit && distance.get(j) <= next) continue;
      visited.set(j, visit);
      distance.set(j, next);
      queue.push(j, next);
    }
  }
  return null;
}
function recordCollision(
  map: PhysicalField,
  context: PhysicalContext,
  i: number,
  contact: Contact
) {
  const strain = map.TectonicStrain.get(i);
  const collision = clamp(round(strain * (0.55 + contact.proximity * 0.45)), 0, 1000);
  const pair = map.CrustSuturePairIds.get(i),
    strength = map.CrustSutureStrength.get(i);
  const matches = pair === contact.pair;
  if (pair === 0 || matches || collision >= strength) {
    const retained = matches ? strength : 0;
    const gain = Math.trunc(
      ((1000 - retained) *
        context.Profile.ContinentalSutureStrengthGain *
        collision *
        context.TectonicStrength) /
        1_000_000_000
    );
    map.CrustSuturePairIds.set(i, contact.pair);
    map.CrustSutureStrength.set(i, clamp(retained + Math.max(1, gain), 1, 1000));
  }
  const inherited =
    map.CrustSuturePairIds.get(i) === contact.pair
      ? Math.trunc((map.CrustSutureStrength.get(i) * strain) / 1000)
      : 0;
  map.CrustCollisionIntensity.set(i, Math.max(collision, inherited));
}
export function continentalSutures(map: PhysicalField, context: PhysicalContext) {
  const count = map.mesh.count,
    p = context.Profile;
  map.CrustCollisionIntensity.fill(0);
  for (let i = 0; i < count; i++) {
    const suture = map.CrustSutureStrength.get(i);
    if (suture > 0)
      map.RockResistance.set(
        i,
        Math.max(
          map.RockResistance.get(i),
          1000 + Math.trunc(((p.OrogenicCoreRockResistance - 1000) * suture) / 1000)
        )
      );
  }
  const visited = workingArray(map, "int32", "sutures:visited"),
    distance = workingArray(map, "float64", "sutures:distance");
  let visit = 0;
  for (let i = 0; i < count; i++) {
    if (map.TectonicBoundaryCodes.get(i) !== 1 || map.TectonicStrain.get(i) <= 0) continue;
    const contact = findContact(map, context, i, visited, distance, ++visit);
    if (contact) recordCollision(map, context, i, contact);
  }
  releaseWorking(map, visited, distance);
}
