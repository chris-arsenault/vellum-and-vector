import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { nearestTriangle, meshDeltaX, meshPoint } from "./mesh";
import { tectonicArcMeltShare, tectonicArcOffset } from "./tectonicControls";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { rockCatalogue } from "../rock/rockCatalogue";
import { intrudeBasement } from "../rock/rockColumn";
import type { VolcanicLava } from "../processes/volcanicLava";

/** Metres of older volcanic rock retained above an arc's intrusive basement. */
const arcShell = 3000;

function overridingSide(map: PhysicalField, cell: number) {
  const state = map.tectonics;
  if (!state) return null;
  const pair = map.TectonicBoundaryPairIds.get(cell),
    a = state.sites[(pair >>> 16) - 1],
    b = state.sites[(pair & 0xffff) - 1];
  if (!a || !b || a.plate === b.plate) return null;
  const ai = nearestTriangle(map.mesh, a.x, a.y),
    bi = nearestTriangle(map.mesh, b.x, b.y);
  if (ai < 0 || bi < 0) return null;
  const score = (i: number) => map.CrustContinentalFraction.get(i) * 2 - map.CrustAge.get(i),
    sign = score(ai) >= score(bi) ? -1 : 1,
    dx = meshDeltaX(map.mesh, b.x - a.x),
    dy = b.y - a.y,
    length = Math.max(1, Math.hypot(dx, dy));
  return [(sign * dx) / length, (sign * dy) / length];
}

/** Sinking crust supplies vents on the overriding side; terrain, not a radial kernel, routes melt. */
export function subductionArcs(map: PhysicalField, context: PhysicalContext, lava: VolcanicLava) {
  const supply = workingArray(map, "float64", "arcs:supply");
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const consumed = map.OceanicSubduction.get(cell),
      normal = overridingSide(map, cell);
    if (consumed <= 0 || !normal) continue;
    const [x, y] = meshPoint(
        map.mesh,
        map.mesh.x(cell) + normal[0] * tectonicArcOffset,
        map.mesh.y(cell) + normal[1] * tectonicArcOffset
      ),
      source = nearestTriangle(map.mesh, x, y);
    if (source >= 0)
      supply.add(source, (consumed / 1024) * map.mesh.area(cell) * tectonicArcMeltShare);
  }
  try {
    for (let source = 0; source < map.mesh.count; source++) {
      const volume = supply.get(source);
      if (volume <= 0) continue;
      const eruption = lava.erupt(source, volume);
      if (eruption.volume <= 0) continue;
      intrudeBasement(map, source, rockCatalogue.granite, arcShell * 1024);
      map.events.push({
        id: `volcano:arc:${source}:${context.EpochIndex}`,
        kind: "volcano",
        x: map.mesh.x(source),
        y: map.mesh.y(source),
        radius: eruption.radius,
        epoch: Math.max(0, context.EpochIndex),
        strength: map.VolcanicActivity.get(source),
      });
    }
    map.OceanicSubduction.fill(0);
  } finally {
    releaseWorking(map, supply);
  }
}
