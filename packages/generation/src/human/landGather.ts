import type { Band } from "@atlas/domain";
import { defineCommand, runOperation } from "../processOperation";
import { moveHumanLayer } from "./layerOperations";
import { fedBy, habitable, km2, people, working, type LandWork } from "./landWork";
import { pressure } from "./passFacts";
import { reach } from "./reach";

/**
 * Gather: people move along the going. Where a cell is nearly full they spill toward the
 * neighbour with most room, which is how empty land is taken up. And they drain toward the
 * crowds they can reach: every cell feels the people around it, less across costly ground,
 * and sends a share of its own to the neighbour through which it feels the most. Crowds
 * therefore form where the going from many sides is cheap, and take the terrain's shape.
 */
interface Leaving {
  targets: Band;
  share: Band;
}
/** For each cell with people, the neighbour that scores best and the share that goes to it. */
function choose(
  work: LandWork,
  leaving: Leaving,
  score: (to: number, passed: number) => number,
  going: (from: number, to: number, passed: number) => number
) {
  const { map, going: passage } = work,
    mesh = map.mesh;
  for (let cell = 0; cell < mesh.count; cell++) {
    leaving.targets.set(cell, -1);
    leaving.share.set(cell, 0);
    if (!habitable(map, cell) || !(people(map, cell) > 0)) continue;
    let best = 0,
      target = -1,
      through = 0;
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const to = mesh.neighbor(cell, edge);
      if (to < 0 || !habitable(map, to)) continue;
      // The share the step itself passes on, without its division among a cell's edges.
      const passed = passage.passed.get(cell * passage.stride + edge) * passage.stride,
        scored = score(to, passed);
      if (scored > best) [best, target, through] = [scored, to, passed];
    }
    if (target < 0) continue;
    leaving.targets.set(cell, target);
    leaving.share.set(cell, work.facts.mobility * going(cell, target, through));
  }
}
function move(work: LandWork, leaving: Leaving) {
  runOperation(work.map, moveHumanLayer, {
    map: work.map,
    kind: "population",
    targets: leaving.targets,
    share: leaving.share,
    years: work.facts.years / work.facts.sweeps,
  });
}
/** People on nearly full land spill to the neighbour with the most room for them. */
function spill(work: LandWork, leaving: Leaving) {
  const { map } = work,
    fed = fedBy(work),
    room = (cell: number) => Math.max(0, fed(cell) - people(map, cell)) * km2(map, cell),
    fill = (cell: number) => (fed(cell) > 0 ? people(map, cell) / fed(cell) : Infinity);
  choose(
    work,
    leaving,
    (to, passed) => room(to) * passed,
    // Nobody leaves land with room to spare; the fuller it is, the more go.
    (from) => Math.min(1, Math.max(0, fill(from) - (1 - pressure)) / pressure)
  );
  move(work, leaving);
}
/** People drain toward the crowds they can reach. */
function drain(work: LandWork, leaving: Leaving) {
  const { map, going } = work,
    crowd = working(map, "crowd"),
    pull = working(map, "pull"),
    // A place draws people while food nobody has claimed can still be had there: as much
    // as would feed the growth its people already press for, and it draws at full strength.
    open = (cell: number) =>
      Math.min(1, work.market.get(cell) / (1 + pressure * people(map, cell) * km2(map, cell)));
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (habitable(map, cell)) crowd.set(cell, people(map, cell) * km2(map, cell));
  reach(map, crowd, pull, going);
  choose(
    work,
    leaving,
    (to, passed) => pull.get(to) * passed * open(to),
    // People follow the pull by how steeply it rises: a rise of the whole pull within the
    // range moves everyone who can go, whatever the size of the cells it is measured over.
    (from, to, passed) => {
      const rise = 1 - pull.get(from) / pull.get(to),
        ofRange = Math.sqrt(1 / passed - 1);
      return rise > 0 ? open(to) * Math.min(1, rise / Math.max(ofRange, 1e-9)) : 0;
    }
  );
  map.coverage.release(crowd);
  map.coverage.release(pull);
  move(work, leaving);
}
export const gatherPeople = defineCommand(
  "human.land.gather",
  "elapsed",
  (work: LandWork) => {
    const leaving = {
      targets: work.map.coverage.scratch("int32", "human:targets", work.map.mesh.count),
      share: working(work.map, "leaving-share"),
    };
    for (let sweep = 0; sweep < work.facts.sweeps; sweep++) {
      spill(work, leaving);
      // Only people who trade food over distance can live as a crowd.
      if (work.facts.farms) drain(work, leaving);
    }
    work.map.coverage.release(leaving.targets);
    work.map.coverage.release(leaving.share);
  },
  []
);
