import { BitSet, type DrainageReach } from "@atlas/domain";
import { riverSignificance } from "../worldSignificance";

/** Confluence samples include the receiving river; tributary evidence stops upstream of it. */
function contribution(reach: DrainageReach) {
  const end = Math.max(0, reach.coordinates.length - 2);
  return { discharge: reach.discharges[end] ?? 0, catchment: reach.catchmentAreas[end] ?? 0 };
}
function length(reach: DrainageReach) {
  return reach.coordinates
    .slice(1)
    .reduce(
      (sum, p, i) =>
        sum + Math.hypot(p[0] - reach.coordinates[i][0], p[1] - reach.coordinates[i][1]),
      0
    );
}

/** Follow the strongest upstream continuation through junctions; other branches stand alone. */
export function worldRiverCourses(reaches: DrainageReach[]) {
  const upstream = reaches.map(() => [] as number[]),
    visited = new BitSet(reaches.length);
  reaches.forEach((reach, i) => {
    if (reach.downstream !== null && reach.downstream !== i) upstream[reach.downstream]?.push(i);
  });
  const continuation = upstream.map(
    (branches) =>
      branches.sort(
        (a, b) => contribution(reaches[b]).discharge - contribution(reaches[a]).discharge || a - b
      )[0]
  );
  const ends = reaches
    .map((_, i) => i)
    .filter((i) => {
      const next = reaches[i].downstream;
      return next === null || continuation[next] !== i;
    });
  return ends.flatMap((end) => {
    const course: number[] = [];
    for (let i: number | undefined = end; i !== undefined && !visited.has(i); i = continuation[i]) {
      visited.add(i);
      course.unshift(i);
    }
    const judgment = riverSignificance({
      ...contribution(reaches[end]),
      length: course.reduce((sum, i) => sum + length(reaches[i]), 0),
      outlet: reaches[end].waterBody !== null,
    });
    return judgment.publish ? [course] : [];
  });
}
