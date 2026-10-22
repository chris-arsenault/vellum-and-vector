import {
  gridPosition,
  gridSampler,
  overlayField,
  requireThat,
  sameValue,
  spatial,
  prepareGridChannel,
  type DomainSnapshot,
  type GridSurface,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { preparePhysicalChannels, type PhysicalArrayName } from "./canonry/continuousState";
import { reconcileWater } from "./canonry/field";
import { waterWrites } from "./canonry/physicalWrites";
import { prepareRiverPaths } from "./canonry/riverChannelPaths";

export function authoredFields(original: DomainSnapshot) {
  const fields = original.world.fields
    .filter((field) => field.state === "authored" || field.state === "protected")
    .map((field) => ({
      id: field.id,
      source: original.numerical[field.id],
      channels: field.channels,
      footprint: field.footprint,
      spaceId: field.spaceId,
      resolution: original.numerical[field.id]?.scope.resolution,
    }));
  const patches = original.fieldPatches.map((patch) => ({
    id: patch.id,
    source: original.numerical[patch.fieldId] ?? original.numerical[patch.resourceId],
    channels: patch.channels,
    footprint: patch.footprint,
    spaceId: patch.spaceId,
    resolution:
      original.numerical[patch.resourceId]?.scope.resolution ??
      original.numerical[patch.fieldId]?.overlays?.find(
        (overlay) => overlay.grid.id === patch.resourceId
      )?.grid.scope.resolution ??
      original.numerical[patch.fieldId]?.scope.resolution,
  }));
  return [...fields, ...patches];
}

// Keep the original overlay authority intact, while exposing its effective
// samples to numerical consumers of the regenerated base at this resolution.
export function composeAuthoredSamples(state: GenerationState, original: DomainSnapshot): void {
  const grid = state.surface;
  for (const authority of authoredFields(original)) {
    if (authority.spaceId && authority.spaceId !== grid.scope.spaceId) continue;
    if (authority.footprint && !spatial.intersects(authority.footprint, grid.scope.footprint))
      continue;
    const source = authority.source;
    requireThat(
      source,
      "authored_field_input",
      "Load the effective sampled field for every authored patch in the generation extent."
    );
    if (source.scope.spaceId !== grid.scope.spaceId || source.scope.crsId !== grid.scope.crsId)
      continue;
    const channels = authority.channels ?? Object.keys(source.channels),
      footprint = authority.footprint ?? source.scope.footprint;
    composeSamples(state, source, channels, footprint);
    composeExactAuthority(grid, authority.id, source, channels, footprint);
  }
}

function composeExactAuthority(
  grid: GridSurface,
  id: string,
  source: GridSurface,
  channels: string[],
  extent: GridSurface["scope"]["footprint"]
) {
  const footprint = spatial.intersection(extent, source.scope.footprint),
    present = channels.filter((channel) => Object.hasOwn(grid.channels, channel));
  if (!footprint || !present.length) return;
  // A child may have no samples inside a small authored patch. Retain its
  // exact geography as well as its contributions to numerical samples.
  grid.overlays = grid.overlays?.filter((overlay) => overlay.grid.id !== id);
  overlayField(grid, { ...source, id, scope: { ...source.scope, footprint } }, present);
}

function composeSamples(
  state: GenerationState,
  source: GridSurface,
  channels: string[],
  footprint: GridSurface["scope"]["footprint"]
) {
  const grid = state.surface;
  for (const channel of channels) {
    if (!grid.channels[channel]) continue;
    requireThat(
      source.channels[channel] && source.units[channel] === grid.units[channel],
      "authored_field_units",
      `Authored ${channel} samples retain their units during generation.`
    );
    const covers = spatial.pointCoverage(footprint),
      sourceCovers = spatial.pointCoverage(source.scope.footprint),
      valueAt = gridSampler(source, channel);
    let mutated = false;
    for (let i = 0; i < grid.active.length; i++) {
      const position = gridPosition(grid, i);
      if (covers(position) && sourceCovers(position)) {
        const transform = grid.prepared?.transforms[channel] ?? { scale: 1, offset: 0 };
        const previous = grid.channels[channel][i];
        grid.channels[channel][i] = (valueAt(position) - transform.offset) / transform.scale;
        mutated ||= grid.channels[channel][i] !== previous;
      }
    }
    if (!mutated) continue;
    const map = state.physical?.map;
    const native =
      map &&
      ((Object.keys(map) as (keyof typeof map)[]).find(
        (name) => map[name] === grid.channels[channel]
      ) as PhysicalArrayName | undefined);
    if (map && native) {
      const hadPaths = Boolean(map.riverPaths);
      const changed: PhysicalArrayName[] = [native];
      if (native === "Elevation") {
        for (let i = 0; i < map.mesh.count; i++) {
          map.BedrockElevation[i] = map.Elevation[i] - map.SedimentThickness[i];
          reconcileWater(map, i);
        }
        changed.push("BedrockElevation", ...waterWrites);
      }
      preparePhysicalChannels(map, changed);
      if (hadPaths && !map.riverPaths) prepareRiverPaths(map);
    } else prepareGridChannel(grid, channel, { transform: grid.prepared?.transforms[channel] });
  }
}

export function validateAuthoredInputs(state: GenerationState, original: DomainSnapshot): void {
  for (const patch of original.fieldPatches) {
    requireThat(
      sameValue(
        patch,
        state.domain.fieldPatches.find((current) => current.id === patch.id)
      ),
      "authored_patch",
      "Generation preserves authored patch records and protection."
    );
    if (original.numerical[patch.resourceId])
      requireThat(
        sameValue(original.numerical[patch.resourceId], state.domain.numerical[patch.resourceId]),
        "authored_patch_resource",
        "Generation preserves the immutable sampled patch resource."
      );
  }
  for (const [id, grid] of Object.entries(original.numerical))
    requireThat(
      sameValue(grid.overlays, state.domain.numerical[id]?.overlays),
      "authored_overlays",
      "Generation preserves exact sampled overlays at their own resolution."
    );
}
