import {
  areaSpace,
  isDescendant,
  point,
  requireThat,
  semanticId,
  spatial,
  type Command,
  type DomainSnapshot,
  type Area,
} from "@atlas/domain";

function brushField(snapshot: DomainSnapshot, areaId: string, data: Record<string, unknown>) {
  return [...snapshot.world.fields].reverse().find((field) => {
    const footprint = snapshot.numerical[field.id]?.scope.footprint ?? field.footprint;
    return (
      footprint &&
      field.channels?.includes(String(data.channel)) &&
      areaSpace(snapshot.world, field.areaId) === areaSpace(snapshot.world, areaId) &&
      isDescendant(snapshot.world.areas, areaId, field.areaId) &&
      spatial.covers(footprint, point(data.center as import("@atlas/domain").Position))
    );
  });
}
function normalizeBrush(snapshot: DomainSnapshot, areaId: string, data: Record<string, unknown>) {
  const field = brushField(snapshot, areaId, data);
  requireThat(field, "missing_field", "Generate or initialize this field before sculpting.");
  return {
    ...data,
    fieldId: field.id,
    mode: data.mode ?? "add",
    amount: data.amount ?? data.delta,
  };
}
function fieldInput(
  snapshot: DomainSnapshot,
  area: Area,
  data: Record<string, unknown>,
  operationId: string
) {
  return {
    ...data,
    id: semanticId(snapshot.world.id, "field", operationId),
    footprint: area.footprint,
    width: Number(data.resolution),
    height: Number(data.resolution),
    channels: {
      [String(data.layerId)]: {
        unit: data.layerId === "elevation" ? "metre" : "ratio",
        values: Number(data.value),
      },
    },
  };
}
export function normalizeCommand(
  snapshot: DomainSnapshot,
  command: Command
): Record<string, unknown> {
  const data = { ...command.data };
  const area =
    snapshot.world.areas[String(data.areaId ?? data.parentId)] ??
    snapshot.world.areas[snapshot.scope.areaId];
  requireThat(area, "missing_area", "Choose an existing mapped area.");
  if (command.kind === "reconcileBoundary" && data.sculpt) {
    const sculpt = data.sculpt as Record<string, unknown>,
      field = brushField(snapshot, String(sculpt.areaId), sculpt);
    requireThat(field, "missing_field", "Choose a field to reconcile.");
    return { ...data, areaId: field.areaId, sculpt: { ...sculpt, fieldId: field.id } };
  }
  if (command.kind === "createArea")
    return {
      ...data,
      id: semanticId(snapshot.world.id, "area", command.operationId),
      layers: Object.values(snapshot.world.layers)
        .filter((l) => l.profiles.includes(data.profile as typeof area.profile))
        .map((l) => l.id),
    };
  if (command.kind === "createField" && !data.channels)
    return fieldInput(snapshot, area, data, command.operationId);
  if (["sculptField", "paintMapField"].includes(command.kind))
    return normalizeBrush(snapshot, area.id, data);
  return data;
}
