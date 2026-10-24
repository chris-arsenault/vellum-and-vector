import { point, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { physicalSampler } from "./physicalMetric";

type Event = NonNullable<GenerationState["physical"]>["map"]["events"][number];

/**
 * Metres the rim stands above both the floor and the surrounding plain, from the current
 * surface: later erosion, deposition and uplift can erase a crater's form.
 */
function craterRelief(state: GenerationState, event: Event) {
  const { map } = state.physical!,
    height = physicalSampler(map.mesh, map.Elevation),
    ring = (distance: number) => {
      let sum = 0,
        count = 0;
      for (let direction = 0; direction < 16; direction++) {
        const angle = (direction * Math.PI) / 8,
          value = height(
            event.x + Math.cos(angle) * distance,
            event.y + Math.sin(angle) * distance
          );
        if (!Number.isFinite(value)) continue;
        sum += value;
        count++;
      }
      return count ? sum / count : NaN;
    };
  const floor = (height(event.x, event.y) + ring(event.radius * 0.4)) / 2,
    rim = ring(event.radius),
    plain = ring(event.radius * 2);
  const relief = Math.min(rim - floor, rim - plain) / 1024;
  return Number.isFinite(relief) ? relief : 0;
}
/** Craters are mapped while their form survives; volcanic cones keep their event geometry. */
function extractEvents(state: GenerationState, selected: { impacts: boolean; volcanism: boolean }) {
  const { map } = state.physical!,
    [x0, y0] = map.mesh.origin;
  for (const event of map.events) {
    const relief = selectedEvent(state, event, selected);
    if (relief === false) continue;
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
      ...relief,
    };
    const feature = generatedFeature(
      state,
      event.id,
      `${kind === "crater" ? "Impact crater" : "Volcano"} ${event.id.split(":").at(-1)}`,
      kind,
      "geology",
      shape,
      attributes
    );
    locateVolcano(state, feature, center);
    putGenerated(state, feature);
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
function locateVolcano(
  state: GenerationState,
  feature: import("@atlas/domain").AtlasFeature,
  center: import("@atlas/domain").Position
) {
  if (
    feature.kind !== "volcano" ||
    !spatial.intersects(point(center), state.domain.scope.footprint)
  )
    return;
  feature.footprint = feature.geometry;
  feature.geometry = point(center);
}
/** False for an unmapped event; otherwise its extra attributes, a crater's surviving relief. */
function selectedEvent(
  state: GenerationState,
  event: Event,
  selected: { impacts: boolean; volcanism: boolean }
): false | { relief?: number } {
  if (event.kind === "plume") return false;
  if (event.kind !== "impact") return selected.volcanism && {};
  const relief = craterRelief(state, event);
  return selected.impacts && relief >= state.physical!.profile.ImpactVisibleRelief && { relief };
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
