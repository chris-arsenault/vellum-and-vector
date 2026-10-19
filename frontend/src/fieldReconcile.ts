import {
  materializeField,
  createIntentRegistry,
  intentSchema,
  requireThat,
  applyFieldBrush,
  type BrushInput,
  type DomainSnapshot,
  type IntentContext,
} from "@atlas/domain";

export function reconcileBrush(
  snapshot: DomainSnapshot,
  context: IntentContext,
  data: Record<string, unknown>
) {
  const field = snapshot.world.fields.find((f) => f.id === data.fieldId);
  requireThat(field, "missing_field", "Choose a field to reconcile.");
  const grid = materializeField(snapshot.numerical[field.id]);
  const values = grid.channels[String(data.channel)];
  requireThat(values, "missing_channel", "Choose an existing field channel.");
  const radius = Number(data.radius),
    amount = Number(data.amount ?? data.delta);
  requireThat(
    radius > 0 && Number.isFinite(amount),
    "brush_values",
    "Use a positive radius and finite change."
  );
  applyFieldBrush(
    {
      ...data,
      radius,
      amount,
      mode: data.mode ?? "add",
      falloff: data.falloff ?? "smooth",
    } as BrushInput,
    structuredClone(grid),
    grid
  );
  return createIntentRegistry()
    .bind(
      intentSchema.parse({
        operationId: context.operationId,
        expectedVersion: snapshot.world.version,
        version: 1,
        kind: "reconcileField",
        scope: context.scope,
        data: {
          id: field.id,
          areaId: field.areaId,
          layerId: field.layerId,
          footprint: grid.scope.footprint,
          ...(grid.topology
            ? { topology: grid.topology }
            : { width: grid.width, height: grid.height }),
          channels: Object.fromEntries(
            Object.entries(grid.channels).map(([name, values]) => [
              name,
              { unit: grid.units[name], values: Array.from(values) },
            ])
          ),
        },
      }),
      context
    )
    .evaluate(snapshot);
}
