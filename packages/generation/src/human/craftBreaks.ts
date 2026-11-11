import { humanLayers, humanRemains } from "@atlas/domain";
import { respond, type AnswerKey } from "../coupling/answers";
import { offerLinks } from "../coupling/links";
import type { PhysicalField } from "../world/field";
import { doorsOn } from "../world/magicVeil";
import { craftOf, practised, seaHeldOff, type Craft } from "./craftCatalogue";
import { peoplePerBuiltKm2 } from "./passFacts";

/**
 * What each craft sets aside. A craft does not improve on a rule: on the share of a cell where
 * it is practised, the rule does not hold, and the craft's own answer stands in its place.
 * Every pass and process that asks the rule meets the break without knowing of it.
 */
function sets(craft: Craft, key: AnswerKey, instead: (map: PhysicalField, cell: number) => number) {
  respond({
    key,
    by: craft.name,
    reads: [craft.medium],
    share: (map, cell) => practised(map, craft, cell),
    instead: (map, cell) => instead(map, cell),
  });
}
const nothing = () => 0;

// Fire. A kept hearth holds its own season: within it the year is as good for growing as a
// year can be, whatever the climate and the ice say. And where cores are cracked the ground
// holds nothing against a way: it is crossed as open level ground is.
const fire = craftOf("fire");
sets(fire, "season", () => 1);
sets(fire, "climbing", nothing);

// Aurora. What is read out of the ice is not gone: ways, kept lines and what a people holds
// do not fade where its readers work.
sets(craftOf("aurora"), "forgetting", nothing);

// Greenwood. Those who tend are bound to what they tend: they do not leave it and they raise
// nothing on it; and at a tended spring hunger and hurt take no one.
const greenwood = craftOf("greenwood");
sets(greenwood, "moving", nothing);
sets(greenwood, "building", nothing);
sets(greenwood, "harm", nothing);

// Salt. An oath sworn on raked ground does not give way; and on that ground the remembered
// dead are present: as many as the place's remains once housed, where that is more than live
// there now.
const salt = craftOf("salt");
sets(salt, "yielding", nothing);
sets(salt, "presence", (map, cell) =>
  Math.max(
    map[humanLayers.population].get(cell),
    map[humanRemains.builtUp].get(cell) * peoplePerBuiltKm2
  )
);

// Pressure. Where divers hold it, the sea stands where they put it: off the shallows beside
// their shore. The sea stands as far below the bed as it would have stood above it, so a
// cell most of which is held is dry, and a cell less than half held is sea as before.
const pressure = craftOf("pressure");
respond({
  key: "seaStand",
  by: pressure.name,
  reads: [pressure.medium, "Elevation"],
  share: (map, cell) => seaHeldOff(map, cell),
  instead: (map, cell) => 2 * map.Elevation.get(cell) - map.EffectiveSeaLevel,
});

// Veil. A door kept at both ends is a step between two places that do not touch: whatever
// travels the land takes it. The better it is kept, the cheaper the crossing; a door with no
// keeper at either end is no step at all.
const veil = craftOf("veil");
/** How far a door's end is kept: the craft practised on its cell or beside it. */
function kept(map: PhysicalField, cell: number) {
  let keeping = practised(map, veil, cell);
  for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
    const next = map.mesh.neighbor(cell, edge);
    if (next >= 0) keeping = Math.max(keeping, practised(map, veil, next));
  }
  return keeping;
}
offerLinks(veil.name, (map) =>
  doorsOn(map).flatMap(({ a, b }) => {
    const keeping = Math.min(kept(map, a), kept(map, b));
    return keeping > 0 ? [{ a, b, cost: map.mesh.spacing / keeping }] : [];
  })
);

// Hallowed. Inside the vow nothing is harmed; what was turned away lands on the ground beside
// it, which takes its own share and its neighbours' too.
const hallowed = craftOf("hallowed");
sets(hallowed, "harm", nothing);
respond({
  key: "harm",
  by: "the vow's rim",
  reads: [hallowed.medium],
  scale(map, cell) {
    let turned = 0;
    for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
      const next = map.mesh.neighbor(cell, edge);
      if (next >= 0) turned = Math.max(turned, practised(map, hallowed, next));
    }
    return 1 + turned;
  },
});
