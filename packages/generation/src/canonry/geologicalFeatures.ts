import {
  canonicalGeometry,
  canonicalPosition,
  unwrapCoordinates,
  point,
  spatial,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { physicalSampler } from "./physicalMetric";
import { isWorldGeography } from "../worldSignificance";

type Event = NonNullable<GenerationState["physical"]>["map"]["events"][number];
/** Surviving relief distinguishes a major volcanic mountain from an old event location. */
const worldVolcanicRelief = 1_000;
const worldCraterRelief = 150;
const worldCraterRadius = 15_000;
/** Fault systems need a long retained trace; individual local fractures remain physical. */
const worldFaultLength = 150_000;

function volcanicRelief(state: GenerationState, event: Event) {
  const map = state.physical!.map,
    height = physicalSampler(map.mesh, map.Elevation);
  let surrounding = 0;
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8;
    surrounding += height(
      event.x + Math.cos(angle) * event.radius * 2,
      event.y + Math.sin(angle) * event.radius * 2
    );
  }
  return (height(event.x, event.y) - surrounding / 16) / 1024;
}

function eventDisk(
  state: GenerationState,
  center: import("@atlas/domain").Position,
  radius: number
) {
  const disk = spatial.buffer(point(center), radius);
  return (
    disk &&
    spatial.intersection(
      canonicalGeometry(state.domain.world.reference, disk),
      state.domain.scope.footprint
    )
  );
}

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
    const center = canonicalPosition(state.domain.world.reference, {
      x: x0 + event.x,
      y: y0 + event.y,
      z: 0,
    });
    const shape = eventDisk(state, center, event.radius);
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
    const caldera = eventDisk(state, center, event.radius * 0.28);
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
  // Plume roots have no surface form; landmark events publish through their own record.
  if (event.kind === "plume" || event.kind === "landmark") return false;
  if (event.kind !== "impact") return selected.volcanism && selectedVolcano(state, event);
  const relief = craterRelief(state, event);
  if (isWorldGeography(state) && (event.radius < worldCraterRadius || relief < worldCraterRelief))
    return false;
  return selected.impacts && relief >= state.physical!.profile.ImpactVisibleRelief && { relief };
}
function selectedVolcano(state: GenerationState, event: Event) {
  return (!isWorldGeography(state) || volcanicRelief(state, event) >= worldVolcanicRelief) && {};
}
function extractFaults(state: GenerationState) {
  const { map } = state.physical!,
    [x0, y0] = map.mesh.origin;
  for (const fault of map.faults) {
    // A landmark's own fault trace publishes as the landmark, not as a second fault row.
    if (fault.coordinates.length < 2 || fault.id.startsWith("landmark:")) continue;
    const length = fault.coordinates
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum + Math.hypot(p[0] - fault.coordinates[i][0], p[1] - fault.coordinates[i][1]),
        0
      );
    if (isWorldGeography(state) && length < worldFaultLength) continue;
    const line = {
      type: "LineString" as const,
      coordinates: unwrapCoordinates(
        fault.coordinates.map(([x, y]) => [x + x0, y + y0]),
        map.mesh.periodic?.width
      ),
    };
    const shape = spatial.intersection(
      canonicalGeometry(state.domain.world.reference, line),
      state.domain.scope.footprint
    );
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
