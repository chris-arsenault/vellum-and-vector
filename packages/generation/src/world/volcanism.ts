import { crustForming, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { Feature } from "./codes";
import { nearestTriangle } from "./mesh";
import { subductionArcs } from "./volcanicArcs";
import { VolcanicLava } from "../processes/volcanicLava";

/** Existing captured caldera records use this radius share; new eruptions do not invent collapse. */
export const calderaShare = 0.28;

/** Existing source controls specify supplied volume, not the shape of its eventual deposit. */
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

function eruptPlumes(map: PhysicalField, context: PhysicalContext, lava: VolcanicLava) {
  const forming = crustForming(map),
    sequence = forming ? 0 : context.EpochIndex + 1;
  for (const root of map.events.filter((event) => event.kind === "plume")) {
    if (root.strength <= 0) continue;
    const source = nearestTriangle(map.mesh, root.x, root.y);
    if (source < 0) continue;
    // Mantle roots stay put; advection carries their previously emplaced beds and edifices away.
    map.FeatureFlags.set(source, map.FeatureFlags.get(source) | Feature.MantlePlume);
    const eruption = lava.erupt(source, meltVolume(context, root.strength));
    if (eruption.volume <= 0) continue;
    map.events.push({
      id: `volcano:${root.id}:${sequence}`,
      kind: "volcano",
      x: root.x,
      y: root.y,
      radius: eruption.radius,
      epoch: forming ? 0 : context.EpochIndex,
      strength: root.strength,
    });
  }
}

/** Both source mechanisms supply the same connected emplacement on the surviving terrain. */
export function volcanicConstruction(map: PhysicalField, context: PhysicalContext) {
  map.VolcanicActivity.fill(0);
  if (context.Profile.VolcanicConeHeight <= 0) return;
  const clear =
    Feature.MantlePlume |
    (crustForming(map) ? Feature.VolcanicCone | Feature.VolcanicCaldera | Feature.LavaPlain : 0);
  for (let cell = 0; cell < map.mesh.count; cell++)
    map.FeatureFlags.set(cell, map.FeatureFlags.get(cell) & ~clear);
  const lava = new VolcanicLava(map, context);
  try {
    eruptPlumes(map, context, lava);
    subductionArcs(map, context, lava);
  } finally {
    lava.release();
  }
}
