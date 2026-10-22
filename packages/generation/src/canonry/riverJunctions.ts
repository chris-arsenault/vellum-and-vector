import type { PhysicalField } from "./field";
import type { ChannelPaths, ChannelPoint } from "./riverChannelPaths";
import { physicalFieldReader } from "./continuousState";
import { nearestTriangle } from "./mesh";
import { channelDistance, channelTolerance } from "./channelCorridor";

function relaxPoint(map: PhysicalField, paths: ChannelPaths, i: number) {
  const mesh = map.mesh,
    terrain = physicalFieldReader(map, "Elevation"),
    neighbors = [paths.upstream[i], map.FlowTargets[i]];
  const objective = (p: ChannelPoint) => ({
    height: terrain(...p),
    length: neighbors.reduce((sum, j) => sum + channelDistance(p, [paths.x[j], paths.y[j]]), 0),
  });
  let point: ChannelPoint = [paths.x[i], paths.y[i]],
    value = objective(point);
  let step = mesh.topology ? Math.min(mesh.cellWidth[i], mesh.cellHeight[i]) / 4 : mesh.spacing / 4;
  while (step > channelTolerance(map, i)) {
    let next = point,
      best = value;
    for (let direction = 0; direction < 8; direction++) {
      const angle = (direction * Math.PI) / 4,
        candidate: ChannelPoint = [
          point[0] + step * Math.cos(angle),
          point[1] + step * Math.sin(angle),
        ];
      if (nearestTriangle(mesh, ...candidate) !== i) continue;
      const score = objective(candidate);
      const improves =
        score.height < best.height - 1e-6 ||
        (Math.abs(score.height - best.height) <= 1e-6 && score.length < best.length);
      if (improves) {
        next = candidate;
        best = score;
      }
    }
    if (next === point) step /= 2;
    else {
      point = next;
      value = best;
    }
  }
  return point;
}

/** Generation locates shared junctions against terrain without changing flow topology. */
export function relaxRiverJunctions(map: PhysicalField, paths: ChannelPaths) {
  for (let i = 0; i < map.mesh.count; i++) {
    const j = map.FlowTargets[i];
    if (j < 0) continue;
    const previous = paths.upstream[j];
    if (
      map.RiverOrders[i] > 0 &&
      (previous < 0 || map.FlowAccumulation[i] > map.FlowAccumulation[previous])
    )
      paths.upstream[j] = i;
  }
  const cells = Array.from({ length: map.mesh.count }, (_, i) => i)
    .filter(
      (i) =>
        map.RiverOrders[i] > 0 &&
        paths.upstream[i] >= 0 &&
        map.FlowTargets[i] >= 0 &&
        map.WaterKindCodes[i] === 0
    )
    .sort((a, b) => map.DrainageElevations[a] - map.DrainageElevations[b] || a - b);
  let moved = true;
  while (moved) {
    moved = false;
    for (const i of cells) {
      const point = relaxPoint(map, paths, i);
      moved ||= channelDistance([paths.x[i], paths.y[i]], point) > channelTolerance(map, i);
      [paths.x[i], paths.y[i]] = point;
    }
  }
}
