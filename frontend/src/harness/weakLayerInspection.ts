import { MapScale } from "@atlas/domain";
import { groundOf } from "../../../packages/generation/src/rock/ground";
import { inheritedDetachment } from "../../../packages/generation/src/rock/groundWeakLayers";
import {
  yieldingPlane,
  seamContinuity,
  type YieldingPlane,
} from "../../../packages/generation/src/rock/groundQueries";
import { extractableDepth } from "../../../packages/generation/src/rock/groundExtraction";
import { rockKindOfCode } from "../../../packages/generation/src/rock/rockCatalogue";
import type { PhysicalField } from "../../../packages/generation/src/world/field";

const metres = (native: number) => MapScale.metres(native, "native");
const query = yieldingPlane(undefined, "detachment");

function located(map: PhysicalField, cell: number) {
  return {
    cell,
    x: map.mesh.x(cell) + map.mesh.origin[0],
    y: map.mesh.y(cell) + map.mesh.origin[1],
    elevationMetres: metres(map.Elevation.get(cell)),
    water: map.WaterKindCodes.get(cell),
  };
}
function facetsAt(map: PhysicalField, cell: number) {
  const ground = groundOf(map);
  return (["land", "cut"] as const).map((facet) => {
    const plane = ground.fold(cell, query, facet);
    let top = 0;
    return {
      facet,
      share: ground.share(cell, facet),
      surface: ground.surface(cell, facet),
      plane,
      layers: ground.section(cell, facet).map((layer) => {
        const selected =
          layer.medium === "rock" &&
          layer.kind === plane.kind &&
          top === plane.overburden &&
          extractableDepth(layer, layer.basement) === plane.thickness;
        top += layer.depth;
        return {
          ...layer,
          kindName: rockKindOfCode(layer.kind).id,
          depthMetres: metres(layer.depth),
          finiteDepthMetres: metres(extractableDepth(layer, layer.basement)),
          selected,
        };
      }),
    };
  });
}
function sample(map: PhysicalField, cell: number, planes: YieldingPlane[], spread: Float64Array) {
  const neighbors = [],
    facets = facetsAt(map, cell);
  for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
    const neighbor = map.mesh.neighbor(cell, edge);
    if (neighbor < 0) continue;
    const distance = map.mesh.edgeLength(cell, edge),
      target = facetsAt(map, neighbor);
    neighbors.push({
      ...located(map, neighbor),
      spread: spread[neighbor],
      connections: facetConnections(
        facets,
        target,
        MapScale.native(map.mesh.edgeX(cell, edge) * distance),
        MapScale.native(map.mesh.edgeY(cell, edge) * distance)
      ),
      plane: planes[neighbor],
      facets: target,
    });
  }
  return {
    ...located(map, cell),
    spread: spread[cell],
    plane: planes[cell],
    facets,
    neighbors,
  };
}
function facetConnections(
  source: ReturnType<typeof facetsAt>,
  target: ReturnType<typeof facetsAt>,
  dx: number,
  dy: number
) {
  return source
    .filter((part) => part.share > 0)
    .flatMap((a) =>
      target
        .filter((part) => part.share > 0)
        .map((b) => ({
          source: a.facet,
          target: b.facet,
          share: a.share * b.share,
          continuity: seamContinuity(a.plane, b.plane, b.surface - a.surface, dx, dy),
        }))
    );
}
function connectedGroups(map: PhysicalField, planes: YieldingPlane[], spread: Float64Array) {
  const seen = new Uint8Array(map.mesh.count),
    groups = [];
  const eligible = (cell: number, kind?: number) =>
    cell >= 0 &&
    !seen[cell] &&
    spread[cell] > 0 &&
    map.mesh.membership(cell) === 1 &&
    (kind === undefined || planes[cell].kind === kind);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (!eligible(cell)) continue;
    const cells = [cell],
      kind = planes[cell].kind;
    seen[cell] = 1;
    let candidate = cell;
    for (let at = 0; at < cells.length; at++) {
      const here = cells[at];
      if (spread[here] > spread[candidate]) candidate = here;
      for (let edge = 0; edge < map.mesh.degree(here); edge++) {
        const next = map.mesh.neighbor(here, edge);
        if (!eligible(next, kind)) continue;
        seen[next] = 1;
        cells.push(next);
      }
    }
    groups.push({ kind: rockKindOfCode(kind).id, cells, candidate, spread: spread[candidate] });
  }
  return groups.sort((a, b) => b.cells.length - a.cells.length);
}

/** Read-only candidates for geological inspection, not a numerical acceptance criterion. */
export function inspectWeakLayers(map: PhysicalField, selectedCells: readonly number[] = []) {
  const ground = groundOf(map),
    planes = Array.from({ length: map.mesh.count }, (_, cell) => ground.fold(cell, query)),
    spread = Float64Array.from(planes, (_, cell) => inheritedDetachment(map, cell)),
    groups = connectedGroups(map, planes, spread),
    selected = new Set<number>(),
    kinds = new Set<string>();
  groups.forEach((group, index) => {
    if (index < 8 || !kinds.has(group.kind)) selected.add(group.candidate);
    kinds.add(group.kind);
  });
  const isolatedKinds = new Set<number>();
  planes.forEach((plane, cell) => {
    if (
      map.mesh.membership(cell) !== 1 ||
      spread[cell] > 0 ||
      plane.overburden <= 0 ||
      plane.capStrength <= plane.strength ||
      isolatedKinds.has(plane.kind)
    )
      return;
    selected.add(cell);
    isolatedKinds.add(plane.kind);
  });
  for (const cell of selectedCells) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= map.mesh.count)
      throw new Error("Weak-layer inspection requires valid cell indices");
    selected.add(cell);
  }
  const cells = [...selected];
  process.stdout.write(`\nweak-layer candidate cells: ${cells.join(",")}\n`);
  return {
    interpretation:
      "Groups use dominant selected material only to locate samples; their response can belong to another facet. Inspect finite intervals and actual facet connections before interpreting a preserved seam.",
    cellSpanMetres: map.mesh.spacing,
    groups,
    samples: cells.map((cell) => sample(map, cell, planes, spread)),
  };
}
