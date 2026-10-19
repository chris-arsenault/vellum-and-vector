// VolcanicConstructionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, units } from "./math";
import { hashUnit } from "./noise";
import { Feature } from "./codes";
import { rebuild } from "./surface";

export function plumeCenter(
  context: PhysicalContext,
  root: { x: number; y: number; id: string },
  sequence: number
): [number, number] {
  const id = Number(root.id.split(":").at(-1));
  const angle = hashUnit(0x51f3, id, sequence) * Math.PI * 2;
  const distance =
    context.Profile.MantlePlumeDriftPerEpoch * (0.35 + hashUnit(0x2c87, id, sequence) * 0.65);
  return [root.x + Math.cos(angle) * distance, root.y + Math.sin(angle) * distance];
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
  if (!hasVolcanism(context)) return;
  const clear =
    Feature.MantlePlume |
    (context.IsEvolutionEpoch
      ? 0
      : Feature.VolcanicCone | Feature.VolcanicCaldera | Feature.LavaPlain);
  for (let i = 0; i < map.mesh.count; i++) map.FeatureFlags[i] &= ~clear;
  const sequence = context.IsEvolutionEpoch ? context.EpochIndex + 1 : 0,
    recorded = context.IsEvolutionEpoch ? context.EpochIndex : 0;
  for (const root of map.events.filter((event) => event.kind === "plume")) {
    const strength = root.strength;
    if (strength <= 0) continue;
    const center = plumeCenter(context, root, sequence);
    const caldera =
      hashUnit(context.Seed ^ 0x2f41, Number(root.id.split(":").at(-1)), sequence) <
      context.Profile.VolcanicCalderaChance / 1000;
    map.events.push({
      id: `volcano:${root.id}:${sequence}`,
      kind: "volcano",
      x: center[0],
      y: center[1],
      radius: context.Profile.VolcanicConeRadius,
      epoch: recorded,
      strength,
      caldera,
    });
    for (let i = 0; i < map.mesh.count; i++) {
      const distance = Math.hypot(map.mesh.x[i] - center[0], map.mesh.y[i] - center[1]);
      if (distance <= context.Profile.MantlePlumeRadius)
        constructTriangle(map, context, i, distance, strength, recorded, caldera);
    }
  }
}
function hasVolcanism(context: PhysicalContext) {
  return context.Profile.VolcanicConeHeight > 0 || context.Profile.VolcanicApronHeight > 0;
}
