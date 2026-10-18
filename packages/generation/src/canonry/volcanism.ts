// VolcanicConstructionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, units } from "./math";
import { hashUnit } from "./noise";
import { Feature } from "./codes";
import { triangleDistanceSquared } from "./radial";
import { rebuild } from "./surface";

function nextAlongMotion(map: PhysicalField, current: number, mx: number, my: number): number {
  let best = current,
    alignment = 0;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[current * 3 + edge];
    if (j < 0 || j >= map.mesh.contentCount) continue;
    const dx = Math.fround(map.mesh.x[j] - map.mesh.x[current]),
      dy = Math.fround(map.mesh.y[j] - map.mesh.y[current]);
    const score = Math.fround(Math.fround(dx * mx) + Math.fround(dy * my));
    if (score > alignment) {
      best = j;
      alignment = score;
    }
  }
  return best;
}
function plumeCenter(
  map: PhysicalField,
  context: PhysicalContext,
  root: number,
  sequence: number
): number {
  const angle = hashUnit(0x51f3, root, sequence) * Math.PI * 2;
  const mx = round(Math.cos(angle) * 1000),
    my = round(Math.sin(angle) * 1000);
  const steps = round(
    context.Profile.MantlePlumeDriftPerEpoch * (0.35 + hashUnit(0x2c87, root, sequence) * 0.65)
  );
  let current = root;
  for (let step = 0; step < steps; step++) {
    const next = nextAlongMotion(map, current, mx, my);
    if (next === current) break;
    current = next;
  }
  return current;
}
function physicalFeatures(
  map: PhysicalField,
  context: PhysicalContext,
  i: number,
  distance: number,
  activity: number,
  strength: number,
  caldera: boolean
) {
  const p = context.Profile;
  map.FeatureFlags[i] |=
    distance <= p.VolcanicConeRadius ? Feature.VolcanicCone : Feature.LavaPlain;
  if (caldera && distance <= p.VolcanicConeRadius * 0.28)
    map.FeatureFlags[i] |= Feature.VolcanicCaldera;
  if (activity >= Math.min(600, Math.trunc((strength * 3) / 4)))
    map.FeatureFlags[i] |= Feature.MantlePlume;
}
function constructTriangle(
  map: PhysicalField,
  context: PhysicalContext,
  i: number,
  distance: number,
  strength: number,
  recordedEpoch: number,
  caldera: boolean
) {
  const p = context.Profile,
    apron = Math.max(0, 1 - distance / p.MantlePlumeRadius),
    cone = Math.max(0, 1 - distance / p.VolcanicConeRadius);
  const crust = map.CrustTypeCodes[i] === 2 ? 0.72 : 1;
  const uplift = Math.max(
    1,
    units(
      (((p.VolcanicApronHeight * apron + p.VolcanicConeHeight * cone * cone) * strength) / 1000) *
        crust
    )
  );
  const radius = p.VolcanicConeRadius * 0.28;
  const cut =
    caldera && distance < radius
      ? units(p.VolcanicCalderaDepth * (1 - (distance / radius) ** 2))
      : 0;
  map.BedrockElevation[i] = clamp(
    map.BedrockElevation[i] + uplift - cut,
    units(-4000),
    units(4000) - map.SedimentThickness[i]
  );
  map.SurfaceRockLoad[i] += uplift - cut;
  map.VolcanicConstructionHistory[i] += uplift;
  rebuild(map, i);
  const activity = round(strength * apron);
  map.VolcanicActivity[i] = Math.max(map.VolcanicActivity[i], activity);
  if (activity >= Math.trunc(strength / 4)) map.VolcanicLastActiveEpoch[i] = recordedEpoch;
  map.FractureConductance[i] = Math.max(
    map.FractureConductance[i],
    Math.trunc((activity * 7) / 10)
  );
  map.Uplift[i] = Math.max(map.Uplift[i], clamp(cone, 0, 1));
  physicalFeatures(map, context, i, distance, activity, strength, caldera);
}
export function volcanicConstruction(map: PhysicalField, context: PhysicalContext) {
  map.VolcanicActivity.fill(0);
  const clear =
    Feature.MantlePlume |
    (context.IsEvolutionEpoch
      ? 0
      : Feature.VolcanicCone | Feature.VolcanicCaldera | Feature.LavaPlain);
  for (let i = 0; i < map.mesh.count; i++) map.FeatureFlags[i] &= ~clear;
  const sequence = context.IsEvolutionEpoch ? context.EpochIndex + 1 : 0,
    recorded = context.IsEvolutionEpoch ? context.EpochIndex : 0;
  for (let root = 0; root < map.mesh.count; root++) {
    const strength = map.MantlePlumeRootStrength[root];
    if (strength <= 0) continue;
    const center = plumeCenter(map, context, root, sequence);
    const caldera =
      hashUnit(context.Seed ^ 0x2f41, root, sequence) <
      context.Profile.VolcanicCalderaChance / 1000;
    for (let i = 0; i < map.mesh.count; i++) {
      const distance = Math.sqrt(triangleDistanceSquared(map.mesh, i, center));
      if (distance <= context.Profile.MantlePlumeRadius)
        constructTriangle(map, context, i, distance, strength, recorded, caldera);
    }
  }
}
