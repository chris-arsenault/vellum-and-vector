import type { LandscapeProfile } from "./landscapeProfiles";
import type { Geometry } from "geojson";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { finishedElevation, addTerrainProfile, profileElevation } from "./macroTerrain";
import { nearestTriangle } from "./mesh";
import { unitNoise } from "./noise";
import type { PhysicalField } from "./field";

type Event = PhysicalField["events"][number];
function ring(work: AtlasPhysicalWorkspace, event: Event, seed: number, scale = 1) {
  const map = work.map,
    mesh = map.mesh,
    elevation = finishedElevation(work),
    center = elevation(event.x, event.y),
    points: [number, number][] = [],
    heights: number[] = [],
    supported: boolean[] = [];
  for (let n = 0; n < 48; n++) {
    const angle = (Math.PI * 2 * n) / 48,
      dx = Math.cos(angle),
      dy = Math.sin(angle);
    let radius = event.radius * scale,
      height = -Infinity;
    for (const fraction of [0.7, 0.85, 1, 1.15, 1.3]) {
      const distance = event.radius * scale * fraction,
        candidate = elevation(event.x + dx * distance, event.y + dy * distance);
      if (candidate > height) {
        height = candidate;
        radius = distance;
      }
    }
    radius *=
      0.96 +
      unitNoise(event.x + dx * radius, event.y + dy * radius, seed, event.radius * 0.7, 2) * 0.08;
    const x = event.x + dx * radius,
      y = event.y + dy * radius,
      i = nearestTriangle(mesh, x, y),
      support =
        i >= 0 &&
        (event.kind === "impact"
          ? map.ImpactRimUplift[i] > 0
          : map.VolcanicConstructionHistory[i] > 0);
    points.push([x + mesh.origin[0], y + mesh.origin[1]]);
    heights.push(profileElevation(work, height));
    supported.push(support && height > center + 12 * 1024);
  }
  return { points, heights, supported, center: profileElevation(work, center) };
}
function footprint(points: [number, number][]): Geometry {
  return { type: "Polygon", coordinates: [[...points, points[0]]] };
}
export function composeGeologicalEvents(work: AtlasPhysicalWorkspace, seed: number) {
  for (const event of work.map.events) {
    if (event.kind === "plume") continue;
    composeEvent(work, event, seed ^ event.epoch);
  }
}
function composeEvent(work: AtlasPhysicalWorkspace, event: Event, seed: number) {
  const rim = ring(work, event, seed),
    map = work.map,
    cell = nearestTriangle(map.mesh, event.x, event.y);
  if (cell < 0) return;
  const relief =
    event.kind === "impact" ? map.ImpactExcavation[cell] : map.VolcanicConstructionHistory[cell];
  if (!survivingRelief(event, rim, relief)) return;
  const shape = footprint(rim.points),
    entry: { footprint: Geometry; caldera?: Geometry } = { footprint: shape };
  work.finishing!.events.set(event.id, entry);
  fitEventBody(work, event, rim);
  if (event.kind === "impact") fitRimArcs(work, event, rim);
  else {
    if (!event.caldera)
      addTerrainProfile(work, {
        id: `volcano:${event.id}`,
        operation: "raise",
        points: [[event.x + map.mesh.origin[0], event.y + map.mesh.origin[1]]],
        widths: [event.radius],
        values: { elevation: [rim.center + Math.min(180, (relief / 1024) * 0.08)] },
      });
    if (event.caldera) {
      const caldera = ring(work, event, seed ^ 0x66da, 0.28);
      entry.caldera = footprint(caldera.points);
      fitRimArcs(work, { ...event, radius: event.radius * 0.28 }, caldera);
    }
  }
}
function fitEventBody(work: AtlasPhysicalWorkspace, event: Event, rim: ReturnType<typeof ring>) {
  const mesh = work.map.mesh,
    before = finishedElevation(work),
    center: [number, number] = [event.x + mesh.origin[0], event.y + mesh.origin[1]],
    radii = rim.points.map(([x, y]) => Math.hypot(x - center[0], y - center[1])),
    heights = rim.points.map(([x, y], n) => {
      const outer = profileElevation(
          work,
          before(event.x + (x - center[0]) * 1.5, event.y + (y - center[1]) * 1.5)
        ),
        relief = rim.heights[n] - rim.center,
        floor = event.kind === "impact" ? rim.center - Math.max(0, relief) * 0.05 : rim.center,
        middle =
          event.kind === "impact"
            ? floor + relief * 0.18
            : rim.center * 0.55 + rim.heights[n] * 0.45;
      return [floor, middle, rim.heights[n], outer];
    });
  addTerrainProfile(work, {
    id: `event-body:${event.id}`,
    points: [center],
    widths: [Math.max(...radii) * 1.5],
    values: { elevation: [rim.center] },
    operation: "replace",
    plateau: true,
    footprint: footprint(
      rim.points.map(([x, y]) => [
        center[0] + (x - center[0]) * 1.5,
        center[1] + (y - center[1]) * 1.5,
      ])
    ),
    edgeBlend: event.radius * 0.2,
    radial: { center, radii, fractions: [0, 0.55, 1, 1.5], heights },
  });
}
function survivingRelief(event: Event, rim: ReturnType<typeof ring>, history: number) {
  if (event.kind === "impact") return rim.supported.some(Boolean);
  const surrounding = rim.heights.reduce((sum, height) => sum + height, 0) / rim.heights.length;
  return (
    history > 0 &&
    (rim.center > surrounding + 12 || Boolean(event.caldera && rim.supported.some(Boolean)))
  );
}
function fitRimArcs(work: AtlasPhysicalWorkspace, event: Event, rim: ReturnType<typeof ring>) {
  let points: [number, number][] = [],
    heights: number[] = [],
    index = 0;
  const publish = () => {
    if (points.length > 1)
      addTerrainProfile(work, {
        id: `rim:${event.id}:${index++}`,
        points,
        widths: points.map(() => event.radius * 0.16),
        values: {
          elevation: heights.map((height) => height + Math.max(0, height - rim.center) * 0.06),
        },
        operation: "raise",
      });
    points = [];
    heights = [];
  };
  for (let n = 0; n <= rim.points.length; n++) {
    if (n === rim.points.length || !rim.supported[n]) {
      publish();
      continue;
    }
    points.push(rim.points[n]);
    heights.push(rim.heights[n]);
  }
}
export function composeFaults(work: AtlasPhysicalWorkspace, seed: number) {
  const map = work.map,
    before = finishedElevation(work),
    junctions = new Map<string, number>();
  for (const fault of map.faults)
    for (const p of fault.coordinates)
      junctions.set(p.join(":"), (junctions.get(p.join(":")) ?? 0) + 1);
  for (const fault of map.faults) {
    const original = fault.coordinates;
    const heights = fault.coordinates.map(([x, y]) => profileElevation(work, before(x, y)));
    const points = fault.coordinates.map(([x, y], n): [number, number] => {
      if (n === 0 || n === fault.coordinates.length - 1 || junctions.get(`${x}:${y}`)! > 1)
        return [x, y];
      const a = fault.coordinates[n - 1],
        b = fault.coordinates[n + 1],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]),
        offset = (unitNoise(x, y, seed, 60_000, 2) - 0.5) * fault.width;
      return length
        ? [x - ((b[1] - a[1]) / length) * offset, y + ((b[0] - a[0]) / length) * offset]
        : [x, y];
    });
    fault.coordinates = points;
    fitFaultFlanks(work, fault.id, original, points, fault.width, before);
    const profile: LandscapeProfile = {
      id: `fault:${fault.id}`,
      points: points.map(([x, y]) => [x + map.mesh.origin[0], y + map.mesh.origin[1]]),
      widths: points.map(() => Math.max(1000, fault.width)),
      values: { fracture: points.map(() => 0.8), elevation: heights },
      strength: 0.6,
      operation: "replace",
    };
    if (points.length) addTerrainProfile(work, profile);
  }
}
function fitFaultFlanks(
  work: AtlasPhysicalWorkspace,
  id: string,
  original: number[][],
  points: [number, number][],
  width: number,
  before: (x: number, y: number) => number
) {
  if (points.length < 2) return;
  for (const side of [-1, 1]) {
    const sections = points.map((point, n) => {
      const a = original[Math.max(0, n - 1)],
        b = original[Math.min(original.length - 1, n + 1)],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
        dx = (-(b[1] - a[1]) * side * width) / length,
        dy = ((b[0] - a[0]) * side * width) / length;
      return {
        point: [
          point[0] + dx + work.map.mesh.origin[0],
          point[1] + dy + work.map.mesh.origin[1],
        ] as [number, number],
        height: profileElevation(work, before(original[n][0] + dx, original[n][1] + dy)),
      };
    });
    addTerrainProfile(work, {
      id: `fault-flank:${id}:${side}`,
      points: sections.map((s) => s.point),
      widths: sections.map(() => Math.max(1000, width * 0.8)),
      values: { elevation: sections.map((s) => s.height) },
      operation: "replace",
      strength: 0.65,
    });
  }
}
