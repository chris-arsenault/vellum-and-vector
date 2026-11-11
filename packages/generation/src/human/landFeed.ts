import { MapScale, type Band } from "@atlas/domain";
import { ask } from "../coupling/answers";
import { defineCommand, runOperation } from "../processOperation";
import { humanLayersOf } from "./humanLayers";
import { compileLayerMix } from "./layerCatalogue";
import { layHumanLayer, wearHumanLayers } from "./layerOperations";
import { habitable, km2, people, working, type LandWork } from "./landWork";
import { clearingYears, growthRate, marketShare } from "./passFacts";
import { reach } from "./reach";

/**
 * Feed: hungry places are felt by the land around them along the going. Land that would
 * feed more under crops or herds than left wild is brought under them where hunger is felt
 * beyond the spare food already in reach, and goes back where spare food outruns it. Spare
 * food is then shared among the hungers that feel it, so a town eats from its country, and
 * the country that sends it feeds fewer of its own.
 */
const fallow = compileLayerMix({ fallow: 1 });
interface Felt {
  /** By cell: the mouths wanting food there, and the mouths the cell's land could still feed. */
  hunger: Band;
  spare: Band;
  /** The same, as felt from each cell along the going. */
  hungerFelt: Band;
  spareFelt: Band;
}
/** Where food is wanted and where it is spare, as counts of people, and how far each is felt. */
function feel(work: LandWork, margin: number): Felt {
  const { map, context, going } = work,
    support = ask(map, "support", context),
    felt = {
      hunger: working(map, "hunger"),
      spare: working(map, "spare"),
      hungerFelt: working(map, "hunger-felt"),
      spareFelt: working(map, "spare-felt"),
    };
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (!habitable(map, cell)) continue;
    const living = people(map, cell),
      fed = support.get(cell);
    felt.hunger.set(cell, Math.max(0, living * (1 + margin) - fed) * km2(map, cell));
    // Food is spare only where people work the land: a share of what they grow there.
    felt.spare.set(cell, marketShare * Math.min(living, fed) * km2(map, cell));
  }
  reach(map, felt.hunger, felt.hungerFelt, going);
  reach(map, felt.spare, felt.spareFelt, going);
  return felt;
}
const release = (work: LandWork, felt: Felt) =>
  Object.values(felt).forEach((band) => work.map.coverage.release(band));

/** Land goes under crops or herds where that feeds more and hunger is felt; else it goes back. */
function clear(work: LandWork) {
  const { map, context, facts } = work,
    // People clear for the children they will have by the pass's end, not for today's want.
    felt = feel(work, Math.expm1(growthRate * facts.years)),
    crops = working(map, "crops"),
    herds = working(map, "herds"),
    idle = working(map, "idle"),
    crop = ask(map, "cropYield", context),
    herd = ask(map, "herdYield", context),
    wild = ask(map, "wildYield", context),
    rate = 1 - Math.exp(-facts.years / clearingYears),
    layers = humanLayersOf(map);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    // Land is worked by the people on it: nobody clears or keeps ground where nobody lives.
    if (!habitable(map, cell) || !(people(map, cell) > 0)) continue;
    // The hunger around the cell beyond the spare food around it, per square kilometre of
    // the land in reach: if every cell in reach feeds that much more, the hunger is met.
    const wanted = (felt.hungerFelt.get(cell) - felt.spareFelt.get(cell)) / work.land.get(cell),
      farmed = crop.get(cell) >= herd.get(cell),
      gain = Math.max(crop.get(cell), herd.get(cell)) - wild.get(cell);
    if (wanted > 0 && gain > 0)
      (farmed ? crops : herds).set(cell, rate * Math.min(layers.freeArea(cell), wanted / gain));
    else if (wanted < 0)
      idle.set(
        cell,
        (facts.years / clearingYears) *
          Math.min(
            1,
            (felt.spareFelt.get(cell) - felt.hungerFelt.get(cell)) / felt.spareFelt.get(cell)
          )
      );
  }
  release(work, felt);
  runOperation(map, layHumanLayer, { map, kind: "farmland", amount: crops });
  runOperation(map, layHumanLayer, { map, kind: "pasture", amount: herds });
  runOperation(map, wearHumanLayers, { map, mix: fallow, intensity: idle });
  for (const band of [crops, herds, idle]) map.coverage.release(band);
}
/**
 * Spare food reaches the hungers that feel it. Each spare is offered to the hungers in its
 * reach in proportion to how strongly each is felt there; a hunger takes what it is offered up
 * to what it needs; and each spare parts with exactly what was taken of it. Every mouthful
 * brought somewhere left somewhere else.
 */
function share(work: LandWork) {
  const { map, going, imports, facts } = work,
    // Wanting more land is not hunger: only mouths the land does not feed claim food.
    felt = feel(work, 0),
    offered = working(map, "offered"),
    reached = working(map, "reached"),
    taken = working(map, "taken"),
    takenFelt = working(map, "taken-felt"),
    inRange = Math.PI * map.scale.length(facts.range) ** 2;
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (felt.hungerFelt.get(cell) > 0)
      offered.set(cell, felt.spare.get(cell) / felt.hungerFelt.get(cell));
  reach(map, offered, reached, going);
  // A hunger offered more than it needs claims only the share of each offer that fills it.
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (reached.get(cell) > 0)
      taken.set(cell, felt.hunger.get(cell) * Math.min(1, 1 / reached.get(cell)));
  reach(map, taken, takenFelt, going);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (!habitable(map, cell)) continue;
    const brought = taken.get(cell) * reached.get(cell),
      sent = offered.get(cell) * takenFelt.get(cell),
      // Spare food nobody's hunger claims, as the mouths it would feed within the range.
      unclaimed = Math.max(0, felt.spareFelt.get(cell) - felt.hungerFelt.get(cell));
    imports.set(cell, (brought - sent) / km2(map, cell));
    work.market.set(
      cell,
      (unclaimed / work.land.get(cell)) * MapScale.areaUnits(inRange, "m2", "km2")
    );
  }
  release(work, felt);
  for (const band of [offered, reached, taken, takenFelt]) map.coverage.release(band);
}
export const feedPlaces = defineCommand(
  "human.land.feed",
  "work",
  (work: LandWork) => {
    if (!work.facts.farms) return;
    clear(work);
    share(work);
  },
  []
);
