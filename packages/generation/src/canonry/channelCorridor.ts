import { adaptiveCell } from "@atlas/domain";
import type { PhysicalField } from "./field";
import { nearestTriangle } from "./mesh";
import { physicalFieldReader } from "./continuousState";
import type { ChannelPoint, ChannelStation } from "./riverChannelPaths";

export const channelDistance = (a: ChannelPoint, b: ChannelPoint) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
export const channelMix = (a: ChannelPoint, b: ChannelPoint, t: number): ChannelPoint => [
  a[0] + t * (b[0] - a[0]),
  a[1] + t * (b[1] - a[1]),
];

/** Existing channel geometry approximation from the original river path producer. */
export function channelTolerance(map: PhysicalField, i: number, j = i) {
  const mesh = map.mesh;
  return Math.min(
    100,
    (mesh.topology
      ? Math.min(mesh.cellWidth[i], mesh.cellHeight[i], mesh.cellWidth[j], mesh.cellHeight[j])
      : mesh.spacing) / 64
  );
}

function portal(map: PhysicalField, i: number, j: number, a: ChannelPoint, b: ChannelPoint) {
  const mesh = map.mesh;
  if (!mesh.topology) {
    const dx = mesh.x[j] - mesh.x[i],
      dy = mesh.y[j] - mesh.y[i],
      mx = (mesh.x[i] + mesh.x[j]) / 2,
      my = (mesh.y[i] + mesh.y[j]) / 2;
    const t = ((mx - a[0]) * dx + (my - a[1]) * dy) / ((b[0] - a[0]) * dx + (b[1] - a[1]) * dy);
    return channelMix(a, b, Math.max(0, Math.min(1, t)));
  }
  const first = adaptiveCell(mesh.topology, mesh.cellToLeaf[i]),
    last = adaptiveCell(mesh.topology, mesh.cellToLeaf[j]);
  const low: ChannelPoint = [
      Math.max(first[0], last[0]) - mesh.origin[0],
      Math.max(first[1], last[1]) - mesh.origin[1],
    ],
    high: ChannelPoint = [
      Math.min(first[2], last[2]) - mesh.origin[0],
      Math.min(first[3], last[3]) - mesh.origin[1],
    ];
  if (low[0] > high[0] || low[1] > high[1])
    throw new Error(`Drainage edge ${i} -> ${j} has no shared face.`);
  const axis = low[0] === high[0] ? 0 : 1,
    along = 1 - axis;
  // Keep a shared-face station away from an unrelated half-open corner leaf.
  low[along] += 1e-6;
  high[along] -= 1e-6;
  const t = (low[axis] - a[axis]) / (b[axis] - a[axis]),
    point = channelMix(a, b, Math.max(0, Math.min(1, t)));
  return [
    Math.max(low[0], Math.min(high[0], point[0])),
    Math.max(low[1], Math.min(high[1], point[1])),
  ] as ChannelPoint;
}
function valleyControl(map: PhysicalField, a: ChannelPoint, b: ChannelPoint) {
  const mesh = map.mesh,
    terrain = physicalFieldReader(map, "Elevation"),
    length = channelDistance(a, b),
    normal: ChannelPoint = length ? [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] : [0, 0];
  return (center: ChannelPoint, cell: number, span: number): ChannelPoint => {
    let best = center,
      height = terrain(...center),
      offset = 0;
    const width = mesh.topology
      ? Math.min(mesh.cellWidth[cell], mesh.cellHeight[cell])
      : mesh.spacing;
    for (let step = Math.min(width, span) / 4; step > channelTolerance(map, cell); step /= 2) {
      for (const sign of [-1, 1]) {
        const shift = offset + sign * step,
          point: ChannelPoint = [center[0] + normal[0] * shift, center[1] + normal[1] * shift];
        if (nearestTriangle(mesh, ...point) !== cell) continue;
        const z = terrain(...point);
        if (
          z < height - 1e-6 ||
          (Math.abs(z - height) <= 1e-6 && Math.abs(shift) < Math.abs(offset))
        ) {
          best = point;
          height = z;
          offset = shift;
        }
      }
    }
    return best;
  };
}
function appendCurve(
  stations: ChannelStation[],
  first: ChannelPoint,
  control: ChannelPoint,
  last: ChannelPoint,
  low: number,
  high: number,
  tolerance: number
) {
  const t = (low + high) / 2,
    left = channelMix(first, control, 0.5),
    right = channelMix(control, last, 0.5),
    middle = channelMix(left, right, 0.5);
  if (channelDistance(control, channelMix(first, last, 0.5)) / 2 > tolerance) {
    appendCurve(stations, first, left, middle, low, t, tolerance);
    appendCurve(stations, middle, right, last, t, high, tolerance);
  } else stations.push({ point: last, fraction: high, elevation: 0 });
}
/** One producer curve in two adjacent convex cells; later refinement evaluates this curve. */
export function channelCorridor(
  map: PhysicalField,
  i: number,
  j: number,
  a: ChannelPoint,
  b: ChannelPoint
) {
  const face = portal(map, i, j, a, b),
    control = valleyControl(map, a, b),
    split = channelDistance(a, face) / (channelDistance(a, face) + channelDistance(face, b));
  const stations: ChannelStation[] = [{ point: a, fraction: 0, elevation: 0 }];
  appendCurve(
    stations,
    a,
    control(channelMix(a, face, 0.5), i, channelDistance(a, face)),
    face,
    0,
    split,
    channelTolerance(map, i, j)
  );
  appendCurve(
    stations,
    face,
    control(channelMix(face, b, 0.5), j, channelDistance(face, b)),
    b,
    split,
    1,
    channelTolerance(map, i, j)
  );
  return stations;
}
