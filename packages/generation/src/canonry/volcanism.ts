import { meshDeltaX } from "./mesh";
// VolcanicConstructionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, elevationLimit, round, units } from "./math";
import { hashUnit } from "./noise";
import { Feature } from "./codes";
import { rebuild } from "./surface";
import { subductionArcs } from "./volcanicArcs";
import { rockCatalogue } from "../rock/rockCatalogue";
import { layBed, stripRock } from "../rock/rockColumn";

/** A caldera's radius as a share of its cone's. */
export const calderaShare = 0.28;
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
  let flags =
    map.FeatureFlags.get(i) |
    (distance <= p.VolcanicConeRadius ? Feature.VolcanicCone : Feature.LavaPlain);
  if (caldera && distance <= p.VolcanicConeRadius * calderaShare) flags |= Feature.VolcanicCaldera;
  if (activity >= Math.min(600, Math.trunc((strength * 3) / 4))) flags |= Feature.MantlePlume;
  map.FeatureFlags.set(i, flags);
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
  const crust = map.CrustTypeCodes.get(i) === 2 ? 0.72 : 1;
  const uplift = Math.max(
    1,
    units(
      (((p.VolcanicApronHeight * apron + p.VolcanicConeHeight * cone * cone) * strength) / 1000) *
        crust
    )
  );
  const radius = p.VolcanicConeRadius * calderaShare;
  const cut =
    caldera && distance < radius
      ? units(p.VolcanicCalderaDepth * (1 - (distance / radius) ** 2))
      : 0;
  map.BedrockElevation.set(
    i,
    clamp(
      map.BedrockElevation.get(i) + uplift - cut,
      units(-elevationLimit),
      units(elevationLimit) - map.SedimentThickness.get(i)
    )
  );
  map.SurfaceRockLoad.add(i, uplift - cut);
  map.VolcanicConstructionHistory.add(i, uplift);
  stripRock(map, i, cut);
  layBed(map, i, rockCatalogue.basalt, uplift);
  rebuild(map, i);
  const activity = round(strength * apron);
  map.VolcanicActivity.set(i, Math.max(map.VolcanicActivity.get(i), activity));
  if (activity >= Math.trunc(strength / 4)) map.VolcanicLastActiveEpoch.set(i, recordedEpoch);
  map.FractureConductance.set(
    i,
    Math.max(map.FractureConductance.get(i), Math.trunc((activity * 7) / 10))
  );
  map.Uplift.set(i, Math.max(map.Uplift.get(i), clamp(cone, 0, 1)));
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
  for (let i = 0; i < map.mesh.count; i++)
    map.FeatureFlags.set(i, map.FeatureFlags.get(i) & ~clear);
  const sequence = context.IsEvolutionEpoch ? context.EpochIndex + 1 : 0,
    recorded = context.IsEvolutionEpoch ? context.EpochIndex : 0;
  for (const root of map.events.filter((event) => event.kind === "plume")) {
    const strength = root.strength;
    if (strength <= 0) continue;
    // A plume stays put in the mantle; the plate carries what it built away, leaving a chain.
    const center = [root.x, root.y];
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
      const distance = Math.hypot(
        meshDeltaX(map.mesh, map.mesh.x(i) - center[0]),
        map.mesh.y(i) - center[1]
      );
      if (distance <= context.Profile.MantlePlumeRadius)
        constructTriangle(map, context, i, distance, strength, recorded, caldera);
    }
  }
  subductionArcs(map, context);
}
function hasVolcanism(context: PhysicalContext) {
  return context.Profile.VolcanicConeHeight > 0 || context.Profile.VolcanicApronHeight > 0;
}
