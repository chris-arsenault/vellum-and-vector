import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { Landform } from "./codes";

type Curve = { points: [number, number][]; positions: number[] };

/** Concentrate an inherited knickpoint's existing drop; do not invent new falls. */
export function shapeRiverDrops(work: AtlasPhysicalWorkspace, members: number[], curve: Curve) {
  const map = work.map;
  const drops = members
    .flatMap((i, n) => {
      if (n === 0 || n >= members.length - 1 || map.LandformCodes[i] !== Landform.Waterfall)
        return [];
      const before = members[n - 1],
        after = members[n + 1],
        length = Math.hypot(
          map.mesh.x[after] - map.mesh.x[before],
          map.mesh.y[after] - map.mesh.y[before]
        ),
        half = Math.min(0.2, Math.max(0.002, Math.max(50, map.RiverWidth[i] * 2) / length));
      return [
        { n, half, upper: map.DrainageElevations[before], lower: map.DrainageElevations[after] },
      ];
    })
    .filter((drop) => drop.upper - drop.lower > 3 * 1024);
  const stations = [
    ...new Set([...curve.positions, ...drops.flatMap(({ n, half }) => [n - half, n, n + half])]),
  ].sort((a, b) => a - b);
  const source = curve.positions,
    points = curve.points;
  let at = 0;
  curve.points = stations.map((position) => {
    while (at < source.length - 2 && source[at + 1] < position) at++;
    const t = (position - source[at]) / (source[at + 1] - source[at]);
    return [
      points[at][0] * (1 - t) + points[at + 1][0] * t,
      points[at][1] * (1 - t) + points[at + 1][1] * t,
    ];
  });
  curve.positions = stations;
  for (const drop of drops)
    work.finishing!.drops.push({
      id: `fall:${members[drop.n]}`,
      cell: members[drop.n],
      point: curve.points[stations.indexOf(drop.n)],
      drop: (drop.upper - drop.lower) / 1024,
    });
  return (position: number, ordinary: number) => {
    const drop = drops.find(({ n }) => Math.abs(position - n) <= 1);
    if (!drop) return ordinary;
    const t = Math.max(0, Math.min(1, (position - drop.n + drop.half) / (drop.half * 2)));
    return drop.upper * (1 - t) + drop.lower * t;
  };
}
