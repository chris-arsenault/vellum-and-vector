// ContinentalSutureLayer.cs, Canonry 0f62584c: transported material, not site labels.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round } from "./math";
import { PriorityQueue } from "./priorityQueue";

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
    const assembly = map.CrustAssemblyIds[i];
    if (
      assembly <= 0 ||
      map.CrustContinentalFraction[i] < context.Profile.ContinentalSutureMinimumFraction
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
  visited: Int32Array,
  distance: Float64Array,
  visit: number
): Contact | null {
  const p = context.Profile;
  const queue = new PriorityQueue<{ i: number; d: number }>((a, b) => a.d - b.d || a.i - b.i);
  const search = new MaterialSearch();
  visited[start] = visit;
  distance[start] = 0;
  queue.push({ i: start, d: 0 });
  while (queue.count) {
    const { i, d } = queue.pop();
    if (d !== distance[i]) continue;
    search.observe(map, context, i, d);
    const contact = search.contact(p.ContinentalSutureDetectionReach);
    if (contact) return contact;
    if (d >= p.ContinentalSutureDetectionReach) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      const next = d + map.mesh.edgeLength[i * map.mesh.stride + edge];
      if (j < 0 || next > p.ContinentalSutureDetectionReach) continue;
      if (visited[j] === visit && distance[j] <= next) continue;
      visited[j] = visit;
      distance[j] = next;
      queue.push({ i: j, d: next });
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
  const strain = map.TectonicStrain[i];
  const collision = clamp(round(strain * (0.55 + contact.proximity * 0.45)), 0, 1000);
  const pair = map.CrustSuturePairIds[i],
    strength = map.CrustSutureStrength[i];
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
    map.CrustSuturePairIds[i] = contact.pair;
    map.CrustSutureStrength[i] = clamp(retained + Math.max(1, gain), 1, 1000);
  }
  const inherited =
    map.CrustSuturePairIds[i] === contact.pair
      ? Math.trunc((map.CrustSutureStrength[i] * strain) / 1000)
      : 0;
  map.CrustCollisionIntensity[i] = Math.max(collision, inherited);
}
export function continentalSutures(map: PhysicalField, context: PhysicalContext) {
  const count = map.mesh.count,
    p = context.Profile;
  map.CrustCollisionIntensity.fill(0);
  for (let i = 0; i < count; i++)
    if (map.CrustSutureStrength[i] > 0)
      map.RockResistance[i] = Math.max(
        map.RockResistance[i],
        1000 +
          Math.trunc(((p.OrogenicCoreRockResistance - 1000) * map.CrustSutureStrength[i]) / 1000)
      );
  const visited = new Int32Array(count),
    distance = new Float64Array(count);
  let visit = 0;
  for (let i = 0; i < count; i++) {
    if (map.TectonicBoundaryCodes[i] !== 1 || map.TectonicStrain[i] <= 0) continue;
    const contact = findContact(map, context, i, visited, distance, ++visit);
    if (contact) recordCollision(map, context, i, contact);
  }
}
