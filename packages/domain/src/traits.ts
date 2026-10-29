import type { Area, Trait, Position } from "./model";
import { traitSchema } from "./authoringSchemas";
import { spatial, point } from "./spatial";
import { requireThat } from "./errors";
import type { Grid } from "./grids";
import { fieldExtrema } from "./fieldExtrema";

function constrainedAt(area: Area, trait: Trait, p: Position): boolean {
  const location = point(p);
  return (
    (trait.scope === null || spatial.covers(trait.scope, location)) &&
    !area.traits.some(
      (e) =>
        e.kind === "exception" &&
        e.field === trait.field &&
        e.scope &&
        spatial.covers(e.scope, location)
    )
  );
}
function valuesFit(trait: Trait, values: number[]): boolean {
  if (trait.field !== "relief")
    return values.every((v) => v >= trait.minimum && v <= trait.maximum);
  if (values.length === 0) return true;
  const bounds = values.reduce(
    ([min, max], v) => [Math.min(min, v), Math.max(max, v)],
    [Infinity, -Infinity]
  );
  return bounds[1] - bounds[0] <= trait.maximum;
}

export function specializeTraits(
  inherited: Trait[],
  local: Trait[],
  footprint: Area["footprint"]
): Trait[] {
  const result = inherited.filter(
    (t) => t.kind !== "derived" && (t.scope === null || spatial.intersects(t.scope, footprint))
  );
  for (const input of local) {
    const trait = traitSchema.parse(input);
    requireThat(
      trait.scope === null || spatial.covers(footprint, trait.scope),
      "trait_scope",
      "A local trait must lie within its mapped footprint."
    );
    if (trait.kind === "hard")
      for (const parent of result.filter((p) => p.kind === "hard" && p.field === trait.field)) {
        if (parent.scope && trait.scope && !spatial.intersects(parent.scope, trait.scope)) continue;
        requireThat(
          trait.minimum >= parent.minimum && trait.maximum <= parent.maximum,
          "trait_conflict",
          `The local ${trait.field} constraint must specialize its inherited envelope.`
        );
      }
    result.push(trait);
  }
  return result;
}
export function effectiveTraits(
  areas: Record<string, Area>,
  id: string,
  path: string[] = []
): Trait[] {
  requireThat(
    !path.includes(id),
    "area_cycle",
    "Trait inheritance requires acyclic geographic ancestry."
  );
  const area = areas[id];
  requireThat(area, "missing_area_context", "Trait inheritance needs its geographic ancestors.");
  const inherited =
    area.parentId === null || area.map ? [] : effectiveTraits(areas, area.parentId, [...path, id]);
  return specializeTraits(inherited, area.localTraits ?? area.traits, area.footprint);
}
export function validateBoundaryTraits(area: Area): void {
  if (!area.boundary) return;
  for (const trait of area.traits.filter((t) => t.kind === "hard")) {
    const channel = trait.field === "relief" ? "elevation" : trait.field;
    const samples = area.boundary.samples.filter(
      (s) => Object.hasOwn(s.values, channel) && constrainedAt(area, trait, s.point)
    );
    if (!samples.length) continue;
    const values = samples.map((s) => s.values[channel]);
    const valid = valuesFit(trait, values);
    requireThat(
      valid,
      "boundary_trait_conflict",
      `The ${trait.field} constraint conflicts with fixed inherited edge samples.`
    );
  }
}
export function validateFieldTraits(area: Area, grid: Grid, channel: string, fact = channel) {
  const values = grid.channels[channel];
  requireThat(values, "missing_channel", `Channel ${channel} is unavailable.`);
  for (const trait of area.traits.filter(
    (t) => t.kind === "hard" && (t.field === fact || (t.field === "relief" && fact === "elevation"))
  )) {
    const region = constrainedRegion(area, trait, grid);
    const range = region ? fieldExtrema(grid, channel, region) : null;
    const valid = range === null || valuesFit(trait, range);
    requireThat(
      valid,
      "field_trait_conflict",
      `Edited ${channel} values violate the effective ${trait.field} constraint.`
    );
  }
}
function constrainedRegion(area: Area, trait: Trait, grid: Grid) {
  let region = spatial.intersection(area.footprint, grid.scope.footprint);
  if (region && trait.scope) region = spatial.intersection(trait.scope, region);
  for (const exception of area.traits.filter(
    (t) => t.kind === "exception" && t.field === trait.field
  ))
    if (region && exception.scope) region = spatial.difference(region, exception.scope);
  return region;
}
