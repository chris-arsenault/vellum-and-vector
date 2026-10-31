import {
  areaSpace,
  type Position,
  type ReadRequirements,
  type DomainSnapshot,
  type FieldRef,
  type BlockCache,
} from "@atlas/domain";
import { FieldWorkingSet, type BrowserWorkspace } from "@atlas/storage-browser";
import { mapRasterFields } from "./workspaceRasters";
import { inspectStoredCell, type CellInspection, type InspectedCell } from "./cellInspection";

/** Open lazy immutable arrays in the workspace worker; only selected cell blocks are decoded. */
export async function workspaceCell(
  current: Pick<BrowserWorkspace, "catalog" | "resources">,
  worldId: string,
  areaId: string,
  position: Position,
  blocks: BlockCache
): Promise<CellInspection> {
  const world = await current.catalog.readEditor(worldId),
    nearest = new Map<string, string>(),
    fields = mapRasterFields(world, areaId),
    cells = new Map<string, InspectedCell>();
  for (const field of fields) for (const name of field.channels ?? []) nearest.set(name, field.id);
  const channels = fields
    .map((field) => ({
      fieldId: field.id,
      names: (field.channels ?? []).filter((name) => nearest.get(name) === field.id),
    }))
    .filter((field) => field.names.length);
  const requirements: ReadRequirements = {
    scope: {
      worldId,
      areaId,
      spaceId: areaSpace(world, areaId),
      crsId: world.reference.id,
      footprint: world.areas[areaId].footprint,
      revision: world.version,
      time: "present",
      resolution: null,
    },
    objects: [{ kind: "field", ids: channels.map(({ fieldId }) => fieldId) }],
    channels,
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
  };
  const snapshot = await current.catalog.readAuthoring(requirements);
  const working = new FieldWorkingSet(current.resources, blocks);
  try {
    for (const { fieldId, names } of channels) {
      const field = fields.find((field) => field.id === fieldId)!,
        { grid, sources } = await inspectedField(
          current,
          working,
          field,
          names,
          snapshot.fieldPatches
        );
      for (const name of names) {
        const cell = inspectStoredCell(grid, position, name);
        if (!cell) continue;
        Object.assign(cell.values[0], {
          fieldId,
          resourceId: sources.get(`${cell.gridId}:${name}`)!,
          input: !!field.input,
        });
        const key = `${cell.gridId}:${cell.index}`,
          previous = cells.get(key);
        if (previous) previous.values.push(...cell.values);
        else cells.set(key, cell);
      }
    }
    return { areaId, position, cells: [...cells.values()] };
  } finally {
    working.close();
  }
}

async function inspectedField(
  current: Pick<BrowserWorkspace, "catalog" | "resources">,
  working: FieldWorkingSet,
  field: FieldRef,
  names: string[],
  patches: DomainSnapshot["fieldPatches"]
) {
  const sources = new Map<string, string>();
  const load = async (id: string, selected: string[]) => {
    const resource = await current.resources.describe(id),
      grid = await working.load(id, selected, {
        id: resource.field!.geographyId,
        scope: resource.scope,
      });
    for (const name of selected) sources.set(`${grid.id}:${name}`, id);
    return grid;
  };
  const grid = await load(field.resourceId!, names),
    overlays = [];
  for (const patch of patches.filter((patch) => patch.fieldId === field.id)) {
    const own = patch.channels.filter((name) => names.includes(name));
    if (own.length) overlays.push({ grid: await load(patch.resourceId, own), channels: own });
  }
  return { grid: { ...grid, overlays }, sources };
}
