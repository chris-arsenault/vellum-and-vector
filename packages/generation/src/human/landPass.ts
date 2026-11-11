import { defineCommand, runOperation } from "../processOperation";
import { dwellOnLand } from "./layerOperations";
import { feedPlaces } from "./landFeed";
import { gatherPeople } from "./landGather";
import { foundPeople, growPeople } from "./landGrow";
import { hardenPlaces } from "./landHarden";
import { closeWork, openWork, type LandPass } from "./landWork";

/**
 * One pass of people on the land: the land is put to feeding them, they grow into what feeds
 * them, gather along the going, build where they stay, and the ground keeps the years. Each
 * step is one aggregate act sized by the years the pass stands for, and reads what the steps
 * before it left. The same pass runs for loose people in an early epoch and settled people in
 * a human era; only its facts differ.
 */
export const advanceHumanLand = defineCommand(
  "human.land.pass",
  "elapsed",
  (pass: LandPass) => {
    const { map, facts } = pass;
    runOperation(map, foundPeople, pass);
    const work = openWork(pass);
    try {
      runOperation(map, feedPlaces, work);
      runOperation(map, growPeople, work);
      runOperation(map, gatherPeople, work);
      runOperation(map, hardenPlaces, work);
      runOperation(map, dwellOnLand, { map, years: facts.years });
    } finally {
      closeWork(work);
    }
  },
  []
);
