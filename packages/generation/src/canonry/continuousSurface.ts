import {
  resampleChannels,
  putChannel,
  type GridSurface,
  type SampledGrid,
  type FieldMesh,
  adaptiveCell,
} from "@atlas/domain";
import type { PhysicalMesh } from "./mesh";
import { physicalSupport } from "./physicalSupport";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { atlasChannels } from "./atlasChannels";
import { derivedBindings } from "./derivedFields";
import { magicChannels, magicFieldDefinitions } from "./magicFieldDefinitions";
import { projectEcologySupport } from "./ecologyPublication";
import { provinceBinding, retainInheritedMotion } from "./motionPublication";

/** Publication and generic generation operations use the physical degrees of freedom. */
export function continuousSurface(
  previous: GridSurface,
  work: AtlasPhysicalWorkspace
): SampledGrid {
  const mesh = work.map.mesh,
    map = work.map;
  const support = fieldMesh(mesh);
  const next: SampledGrid = {
    id: previous.id,
    scope: { ...previous.scope, resolution: mesh.spacing },
    bounds: previous.bounds,
    mesh: support,
    active: Uint8Array.from(mesh.contentAreas, (area) => Number(area > 0)),
    measures: mesh.contentAreas,
    channels: {},
    units: {},
    quantities: {},
    prepared: { support, coefficients: {}, transforms: {} },
  };
  const bindings = [...atlasChannels, ...derivedBindings].filter(
    (binding) => previous.channels[binding.name]
  );
  const owned = new Set(bindings.map((binding) => binding.name));
  for (const field of work.magic?.fields ?? [])
    for (const name of magicChannels) owned.add(`magic:${field.definition.id}:${name}`);
  resampleChannels(
    previous,
    next,
    Object.keys(previous.channels).filter((name) => !owned.has(name))
  );
  for (const b of bindings) {
    putChannel(next, b.name, b.unit, map[b.native], previous.quantities?.[b.name], {
      province: provinceBinding(map, b.name),
      coefficients: map.continuous!.coefficients[b.native],
      adaptive: map.continuous!.adaptive[b.native],
      transform: {
        scale: b.scale,
        offset: (b.offset ?? 0) - (b.datum ? map.BaseSeaLevel * b.scale : 0),
      },
    });
    retainInheritedMotion(map, next, b.name);
  }
  for (const field of work.magic?.fields ?? [])
    for (const name of magicChannels) {
      const key = `magic:${field.definition.id}:${name}`,
        definition = magicFieldDefinitions[name];
      if (previous.channels[key])
        putChannel(next, key, definition.unit, field[name], definition.quantity, {
          coefficients: field.coefficients?.[name],
          adaptive: field.adaptive?.[name],
        });
    }
  next.ocean = previous.ocean;
  if (previous.geography?.occurrences)
    next.geography = { ...next.geography, occurrences: previous.geography.occurrences };
  if (previous.geography?.categories)
    next.geography = { ...next.geography, categories: previous.geography.categories };
  if (previous.geography?.water)
    next.geography = {
      ...next.geography,
      water: {
        ...previous.geography.water,
        elevation: map.Elevation,
        bodyIds: map.WaterBodyIds,
        coefficients: map.continuous!.coefficients.Elevation,
        adaptive: map.continuous!.adaptive.Elevation,
        transform: { scale: 1 / 1024, offset: -map.BaseSeaLevel / 1024 },
      },
    };
  if (previous.geography?.biome) {
    projectEcologySupport(work, next);
    if (next.geography?.biome) next.geography.biome.lakes = previous.geography.biome.lakes;
  }
  return next;
}
function fieldMesh(mesh: PhysicalMesh): FieldMesh {
  const offsets = new Int32Array(mesh.count + 1),
    adjacent: number[] = [];
  const cellBounds = new Float64Array(mesh.count * 4);
  for (let i = 0; i < mesh.count; i++) {
    offsets[i] = adjacent.length;
    for (let e = 0; e < mesh.degree[i]; e++) {
      const j = mesh.neighbors[i * mesh.stride + e];
      if (j >= 0) adjacent.push(j);
    }
    const x = mesh.x[i] + mesh.origin[0],
      y = mesh.y[i] + mesh.origin[1];
    cellBounds.set(
      mesh.topology
        ? adaptiveCell(mesh.topology, mesh.cellToLeaf[i])
        : [
            x - mesh.cellWidth[i] / 2,
            y - mesh.cellHeight[i] / 2,
            x + mesh.cellWidth[i] / 2,
            y + mesh.cellHeight[i] / 2,
          ],
      i * 4
    );
  }
  offsets[mesh.count] = adjacent.length;
  return {
    ...physicalSupport(mesh),
    offsets,
    neighbors: Int32Array.from(adjacent),
    cellBounds,
    ...(mesh.topology
      ? { adaptive: { topology: mesh.topology, leafToSample: mesh.leafToCell } }
      : {}),
  };
}
