import { adaptiveCell, rectangle, spatial, type Bounds } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "./process";
import { generationFeatures } from "./generationFeatures";
import { generatedFeature, putGenerated } from "./mapFeatures";
import { isWorldSociety } from "./societyMapScope";
import { polityCharacter } from "./societyCharacter";

const oceanMasks = new WeakMap<Geometry, (geometry: Geometry) => Geometry | null>();
function excludeOcean(shape: Geometry, ocean: Geometry) {
  let mask = oceanMasks.get(ocean);
  if (!mask) {
    mask = spatial.differenceFrom(ocean);
    oceanMasks.set(ocean, mask);
  }
  return mask(shape);
}

/** Dissolve ownership cells; physical water boundaries remain authoritative. */
export function territoryShape(state: GenerationState, members: Set<string>): Geometry | null {
  const work = state.society!;
  const rows = new Map<string, Bounds[]>();
  for (let i = 0; i < work.owner.length; i++) {
    if (!members.has(work.region.communities[work.owner.get(i)]?.id)) continue;
    const bounds = ownershipBox(state, i);
    const key = `${bounds[1]}:${bounds[3]}`;
    const row = rows.get(key) ?? [];
    row.push(bounds);
    rows.set(key, row);
  }
  const strips: Geometry[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a[0] - b[0]);
    let box = [...row[0]] as Bounds;
    for (const next of row.slice(1)) {
      if (Math.abs(box[2] - next[0]) < 1e-6) box[2] = next[2];
      else {
        strips.push(rectangle(box));
        box = [...next];
      }
    }
    strips.push(rectangle(box));
  }
  return clipWater(state, strips);
}
function ownershipBox(state: GenerationState, i: number): Bounds {
  const grid = state.surface;
  if (grid.topology) return adaptiveCell(grid.topology, i);
  const [w, s, e, n] = grid.bounds,
    x = i % grid.width,
    y = Math.floor(i / grid.width);
  const dx = (e - w) / (grid.width - 1),
    dy = (n - s) / (grid.height - 1);
  return [
    Math.max(w, w + (x - 0.5) * dx),
    Math.max(s, s + (y - 0.5) * dy),
    Math.min(e, w + (x + 0.5) * dx),
    Math.min(n, s + (y + 0.5) * dy),
  ];
}
function clipWater(state: GenerationState, strips: Geometry[]) {
  if (!strips.length) return null;
  const grid = state.surface;
  let shape = spatial.intersection(spatial.unionAll(strips), grid.scope.footprint);
  if (shape && grid.ocean) shape = excludeOcean(shape, grid.ocean);
  for (const lake of generationFeatures(state, { kind: "lake", areaId: grid.scope.areaId }))
    if (shape && spatial.intersects(shape, lake.geometry))
      shape = spatial.difference(shape, lake.geometry);
  return shape;
}
function publishTerritory(
  state: GenerationState,
  polity: string,
  kind: string,
  layer: string,
  relation: string,
  members: Set<string>
) {
  const shape = territoryShape(state, members);
  if (!shape) return;
  const p = state.society!.region.politics!.polities.find((p) => p.id === polity)!;
  const entity = state.domain.world.entities[polity];
  const feature = generatedFeature(
    state,
    `${kind}:${polity}`,
    `${entity.name} ${kind}`,
    kind,
    layer,
    shape,
    { support: p.support, status: p.status, communities: [...members], seat: p.seat }
  );
  feature.relations = [{ targetId: polity, kind: relation }];
  feature.causes = p.causes;
  putGenerated(state, feature);
}
export function publishPolitics(state: GenerationState) {
  const region = state.society!.region,
    politics = region.politics!;
  for (const polity of politics.polities) {
    // What the polity is, read from the communities it holds; the territories carry the rest.
    const entity = state.domain.world.entities[polity.id];
    if (entity && (!state.society!.inherited || isWorldSociety(state)))
      entity.attributes.character = polityCharacter(region, polity);
    const sovereign = new Set(
      Object.keys(politics.sovereignty).filter((id) => politics.sovereignty[id] === polity.id)
    );
    const control = new Set(
      Object.keys(politics.control).filter((id) => politics.control[id] === polity.id)
    );
    publishTerritory(state, polity.id, "sovereignty", "sovereignty", "sovereign", sovereign);
    publishTerritory(state, polity.id, "control", "control", "controlledBy", control);
    publishTerritory(state, polity.id, "claim", "claims", "claimedBy", new Set(polity.claims));
    if (isWorldSociety(state)) continue;
    // Administration is delegated locally and only where effective control exists.
    for (const id of control) {
      const c = state.society!.region.communities.find((c) => c.id === id)!;
      const shape = c.footprint ?? territoryShape(state, new Set([id]));
      if (!shape) continue;
      const feature = generatedFeature(
        state,
        `administration:${id}`,
        `${c.name} district`,
        "jurisdiction",
        "administration",
        shape,
        { communityId: id, contested: politics.contested[id] ?? [] }
      );
      feature.relations = [{ targetId: polity.id, kind: "administeredBy" }];
      putGenerated(state, feature);
    }
  }
}
