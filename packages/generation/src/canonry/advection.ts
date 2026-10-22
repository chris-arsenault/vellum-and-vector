// PlateAdvectionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, units } from "./math";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { rebuild } from "./surface";
import type { Geometry } from "geojson";
import { provinceTransport } from "./provinceTransport";
import { nearestTriangle } from "./mesh";
import { classifyBiome } from "./ecologyEnvironment";
import { point, spatial } from "@atlas/domain";

function lineParts(geometry: Geometry | null): [number, number][][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates as [number, number][]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as [number, number][][];
  return geometry.type === "GeometryCollection" ? geometry.geometries.flatMap(lineParts) : [];
}
function advectGeometry(map: PhysicalField, distance: number) {
  const [ox, oy] = map.mesh.origin,
    transport = provinceTransport(map, distance);
  for (const event of map.events) {
    if (event.kind === "plume") continue;
    const center = point({ x: event.x + ox, y: event.y + oy, z: 0 });
    const footprint =
      event.footprint === undefined ? spatial.buffer(center, event.radius) : event.footprint;
    event.footprint = footprint ? transport.transport(footprint) : null;
    if (event.caldera) {
      const bowl =
        event.calderaFootprint === undefined
          ? spatial.buffer(center, event.radius * 0.28)
          : event.calderaFootprint;
      event.calderaFootprint = bowl ? transport.transport(bowl) : null;
    }
    const delta = transport.displacementAt(event.x + ox, event.y + oy);
    event.x += delta[0];
    event.y += delta[1];
  }
  for (const fault of map.faults) {
    const parts = fault.parts ?? [fault.coordinates];
    if (!parts.some((part) => part.length >= 2)) continue;
    const geometry: Geometry = {
      type: "MultiLineString",
      coordinates: parts.map((part) => part.map(([x, y]) => [x + ox, y + oy])),
    };
    fault.parts = lineParts(transport.transport(geometry)).map((part) =>
      part.map(([x, y]) => [x - ox, y - oy])
    );
    fault.coordinates = [];
  }
}

export function plateAdvection(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile;
  const decay = (p.PlateDriftDecay / 1000) ** Math.max(0, context.EpochIndex);
  const step = p.PlateDriftPerEpoch * decay;
  map.AdvectionSourceIndex.fill(-1);
  map.ConvergentCrustSurplus.fill(0);
  map.LastPlateDriftStep = step;
  if (step <= 0) {
    for (let i = 0; i < map.mesh.count; i++) map.AdvectionSourceIndex[i] = i;
    return;
  }
  advectGeometry(map, step);
  const plan = buildTransportPlan(map, step);
  transportHistory(map, plan);
  const transport = provinceTransport(map, step),
    [ox, oy] = map.mesh.origin;
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustThickness[i] = clamp(map.CrustThickness[i], units(800), units(8000));
    const source = transport.sourceAt(map.mesh.x[i] + ox, map.mesh.y[i] + oy);
    // Compatibility diagnostic: presence denotes old material. Histories use
    // the exact inverse source position, never this nearest numerical sample.
    map.AdvectionSourceIndex[i] = source
      ? nearestTriangle(map.mesh, source[0] - ox, source[1] - oy)
      : -1;
    rebuild(map, i);
    map.BiomeCodes[i] = classifyBiome(map, i);
  }
  map.AccumulatedPlateDrift += step;
}
