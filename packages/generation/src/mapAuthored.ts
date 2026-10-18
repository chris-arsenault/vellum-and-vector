import {
  gridPosition,
  point,
  requireThat,
  sample,
  sameValue,
  spatial,
  type DomainSnapshot,
  type GridSurface,
} from "@atlas/domain";
import type { GenerationState } from "./process";

export function authoredFields(original: DomainSnapshot) {
  const fields = original.world.fields
    .filter((field) => field.state === "authored" || field.state === "protected")
    .map((field) => ({
      source: original.numerical[field.id],
      channels: field.channels,
      footprint: field.footprint,
      spaceId: field.spaceId,
    }));
  const patches = original.fieldPatches.map((patch) => ({
    source: original.numerical[patch.fieldId] ?? original.numerical[patch.resourceId],
    channels: patch.channels,
    footprint: patch.footprint,
    spaceId: patch.spaceId,
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
    composeSamples(
      state,
      source,
      authority.channels ?? Object.keys(source.channels),
      authority.footprint ?? source.scope.footprint
    );
  }
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
    for (let i = 0; i < grid.active.length; i++) {
      const position = gridPosition(grid, i),
        location = point(position);
      if (spatial.covers(footprint, location) && spatial.covers(source.scope.footprint, location))
        grid.channels[channel][i] = sample(source, channel, position);
    }
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
