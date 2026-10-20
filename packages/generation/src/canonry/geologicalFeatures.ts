import { point, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";

/** Event geometry survives even when a cone or crater spans less than one cell. */
function extractEvents(state: GenerationState, selected: { impacts: boolean; volcanism: boolean }) {
  const { map } = state.physical!,
    [x0, y0] = map.mesh.origin;
  for (const event of map.events) {
    if (!selectedEvent(event, selected)) continue;
    const center = { x: x0 + event.x, y: y0 + event.y, z: 0 };
    const disk = spatial.buffer(point(center), event.radius);
    const shape = disk && spatial.intersection(disk, state.domain.scope.footprint);
    if (!shape) continue;
    const kind = event.kind === "impact" ? "crater" : "volcano";
    const attributes = {
      sourceAlgorithm: "canonry-0f62584c",
      causeId: event.id,
      radius: event.radius,
      center,
      epoch: event.epoch,
      strength: event.strength,
    };
    putGenerated(
      state,
      generatedFeature(
        state,
        event.id,
        `${kind === "crater" ? "Impact crater" : "Volcano"} ${event.id.split(":").at(-1)}`,
        kind,
        "geology",
        shape,
        attributes
      )
    );
    if (!event.caldera) continue;
    const bowl = spatial.buffer(point(center), event.radius * 0.28);
    const caldera = bowl && spatial.intersection(bowl, state.domain.scope.footprint);
    if (caldera)
      putGenerated(
        state,
        generatedFeature(state, `${event.id}:caldera`, "Caldera", "caldera", "geology", caldera, {
          ...attributes,
          radius: event.radius * 0.28,
        })
      );
  }
}
function selectedEvent(
  event: NonNullable<GenerationState["physical"]>["map"]["events"][number],
  selected: { impacts: boolean; volcanism: boolean }
) {
  if (event.kind === "plume") return false;
  return event.kind === "impact" ? selected.impacts : selected.volcanism;
}
function extractFaults(state: GenerationState) {
  const { map } = state.physical!,
    [x0, y0] = map.mesh.origin;
  for (const fault of map.faults) {
    if (fault.coordinates.length < 2) continue;
    const line = {
      type: "LineString" as const,
      coordinates: fault.coordinates.map(([x, y]) => [x + x0, y + y0]),
    };
    const shape = spatial.intersection(line, state.domain.scope.footprint);
    if (shape)
      putGenerated(
        state,
        generatedFeature(
          state,
          fault.id,
          `Fault ${fault.id.split(":").at(-1)}`,
          "fault",
          "faults",
          shape,
          { width: fault.width, causeId: fault.id, sourceAlgorithm: "canonry-0f62584c" }
        )
      );
  }
}
export function extractGeologicalEvents(
  state: GenerationState,
  selected = { impacts: true, volcanism: true, fractures: true }
) {
  extractEvents(state, selected);
  if (selected.fractures) extractFaults(state);
}
