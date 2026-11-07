import { meshDeltaX } from "./mesh";
// VolcanicConstructionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, elevationLimit, round, units } from "./math";
import { hashUnit } from "./noise";
import { Feature } from "./codes";
import { rebuild } from "./surface";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { subductionArcs } from "./volcanicArcs";
import type { Band } from "@atlas/domain";
import { rockCatalogue } from "../rock/rockCatalogue";
import { raiseRock } from "../rock/groundLedger";
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
/** The melt a plume brings up over a span, as the volume of the cone it would build on flat ground. */
const meltVolume = (context: PhysicalContext, strength: number) => {
  const p = context.Profile;
  return (
    (Math.PI / 6) *
    p.VolcanicConeRadius ** 2 *
    p.VolcanicConeHeight *
    (strength / 1000) *
    context.Span
  );
};
/**
 * Lava runs out from the vent and stands no steeper than its slope of repose, so what erupts spreads
 * over whatever is there: on bare ground it builds a cone, and on an old cone it adds a skin, so a vent
 * that stays put grows by the volume it is fed and not by a fixed height each time. Finds the summit
 * that volume reaches and writes each cell's rise, in metres.
 */
function fillCone(map: PhysicalField, cells: Vent, volume: number, repose: number, rise: Band) {
  const standing = (n: number) => map.Elevation.get(cells.at[n]) / 1024,
    filled = (summit: number) => {
      let total = 0;
      for (let n = 0; n < cells.at.length; n++)
        total +=
          Math.max(0, summit - repose * cells.distance[n] - standing(n)) *
          map.mesh.area(cells.at[n]);
      return total;
    };
  let low = Infinity;
  for (let n = 0; n < cells.at.length; n++)
    low = Math.min(low, standing(n) + repose * cells.distance[n]);
  let high = low + 2 * elevationLimit;
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (filled(middle) < volume) low = middle;
    else high = middle;
  }
  for (let n = 0; n < cells.at.length; n++)
    rise.set(cells.at[n], Math.max(0, high - repose * cells.distance[n] - standing(n)));
}
/** The cells a plume reaches, and how far each lies from its vent. */
interface Vent {
  at: number[];
  distance: number[];
}
function ventOf(map: PhysicalField, x: number, y: number, reach: number): Vent {
  const vent: Vent = { at: [], distance: [] };
  for (let i = 0; i < map.mesh.count; i++) {
    const distance = Math.hypot(meshDeltaX(map.mesh, map.mesh.x(i) - x), map.mesh.y(i) - y);
    if (distance > reach) continue;
    vent.at.push(i);
    vent.distance.push(distance);
  }
  return vent;
}
function constructTriangle(
  map: PhysicalField,
  context: PhysicalContext,
  i: number,
  distance: number,
  coneRise: number,
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
    units(((p.VolcanicApronHeight * apron * context.Span * strength) / 1000 + coneRise) * crust)
  );
  const radius = p.VolcanicConeRadius * calderaShare;
  const cut =
    caldera && distance < radius
      ? units(p.VolcanicCalderaDepth * (1 - (distance / radius) ** 2))
      : 0;
  const next = clamp(
    map.BedrockElevation.get(i) + uplift - cut,
    units(-elevationLimit),
    units(elevationLimit) - map.SedimentThickness.get(i)
  );
  raiseRock(map, i, next - map.BedrockElevation.get(i), "volcanoes", "melt");
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
    recorded = context.IsEvolutionEpoch ? context.EpochIndex : 0,
    rise = workingArray(map, "float64", "volcano:rise");
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
    const vent = ventOf(map, center[0], center[1], context.Profile.MantlePlumeRadius);
    if (vent.at.length === 0) continue;
    fillCone(map, vent, meltVolume(context, strength), context.Profile.VolcanicRepose, rise);
    vent.at.forEach((i, n) =>
      constructTriangle(map, context, i, vent.distance[n], rise.get(i), strength, recorded, caldera)
    );
  }
  releaseWorking(map, rise);
  subductionArcs(map, context);
}
function hasVolcanism(context: PhysicalContext) {
  return context.Profile.VolcanicConeHeight > 0 || context.Profile.VolcanicApronHeight > 0;
}
