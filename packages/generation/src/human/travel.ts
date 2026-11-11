import { MapScale, type ReadBand } from "@atlas/domain";
import { respond } from "../coupling/answers";
import type { PhysicalField } from "../world/field";
import { physicalDistance } from "../world/physicalMetric";

/**
 * What it costs to travel the land. `travelFriction` is asked per cell: the cost of crossing
 * a metre of it against a metre of open level ground. Rivers and open water carry boats,
 * woods and wetland slow the walker, and ground people have walked is easier to walk again.
 * The cost of a step between two cells adds the climb and the launch from land to water.
 */
// length-unit: ratio
const boatTravel = 0.5;
/** The traveller-years on a cell at which a way is worn in. */
const wornWay = 50_000;
/** Metres of level ground a metre of climb costs. */
const climbCost = 30;
/** The steepest step a walker takes off a river. */
const steepestStep = 0.6;

respond({
  key: "travelFriction",
  by: "ground, cover and water",
  reads: ["WaterKindCodes", "RiverOrders", "TreeCover", "WetlandCover", "IceThickness"],
  base(map, i) {
    // Ice stops boats as it slows walkers: a frozen sea or river is ground to cross.
    const ice = Math.min(1, map.IceThickness.get(i) / map.scale.length(0.00025)),
      afloat = map.WaterKindCodes.get(i) !== 0 || map.RiverOrders.get(i) > 0,
      going = afloat ? boatTravel : 1 + map.TreeCover.get(i) + 2 * map.WetlandCover.get(i);
    return going + 3 * ice;
  },
});
respond({
  key: "travelFriction",
  by: "worn ways",
  reads: ["WalkedRoute", "WaterKindCodes"],
  // A worn way halves the going on land; water is not worn.
  scale: (map, i) =>
    map.WaterKindCodes.get(i) === 0
      ? 1 - 0.5 * (1 - Math.exp(-map.WalkedRoute.get(i) / wornWay))
      : 1,
});

/**
 * The cost of one step between neighbouring cells, in metres of open level ground, given the
 * answered friction. A step too steep to walk costs Infinity.
 */
export function travelStep(map: PhysicalField, friction: Pick<ReadBand, "get">) {
  const launch = map.scale.length(0.0025),
    water = map.WaterKindCodes,
    rivers = map.RiverOrders;
  return (from: number, to: number) => {
    const distance = physicalDistance(map.mesh, from, to),
      going = (distance * (friction.get(from) + friction.get(to))) / 2,
      afloat = water.get(from) !== 0,
      landing = water.get(to) !== 0;
    if (afloat || landing) return going + (afloat === landing ? 0 : launch);
    const rise = Math.abs(
      MapScale.metres(map.Elevation.get(to) - map.Elevation.get(from), "native")
    );
    if (rivers.get(from) > 0 && rivers.get(to) > 0) return going;
    return rise / distance > steepestStep ? Infinity : going + climbCost * rise;
  };
}
