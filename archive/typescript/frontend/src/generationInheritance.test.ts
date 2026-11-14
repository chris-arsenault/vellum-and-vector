import { expect, it } from "vitest";
import { createGrid, rectangle, resampleChannels, type DomainSnapshot } from "@atlas/domain";
import type { Geometry } from "geojson";
import {
  prepareAtlasGeneration,
  prepareRegionalRefinement,
  type GenerationState,
} from "@atlas/generation";
import { createAtlasWorkspace } from "../../packages/generation/src/world/atlasWorkspace";
import { sequenceStages } from "../../packages/generation/src/sequence";
import { generationSnapshot } from "./generationJobs";
import { constructedWorld } from "./constructedWorldFixture";
import { comparableSnapshot, snapshotCopy } from "./testSupport/snapshotCopy";

/** A region is an independent map; its captured inputs are the parent's present channels. */
function mapChild(domain: DomainSnapshot, parentId: string, footprint: Geometry, areaId: string) {
  domain.world.areas[areaId] = {
    ...domain.world.areas[parentId],
    id: areaId,
    name: "Constructed child",
    parentId,
    profile: "region",
    footprint,
    boundary: null,
    map: { sourceAreaId: parentId, sourceRevision: 1, refinementLevel: 1 },
  };
}

it("inherits impact history and fixed geography from the captured parent cells with new impacts disabled", () => {
  const { input, result } = constructedWorld();
  const parent = generationSnapshot(result, input, crypto.randomUUID());
  const before = snapshotCopy(parent);
  const domain = snapshotCopy(parent);
  const areaId = crypto.randomUUID();
  const footprint = rectangle([2200, 100, 3800, 900]);
  mapChild(domain, input.areaId, footprint, areaId);
  domain.world.fields.push({
    id: "captured",
    areaId,
    layerId: "elevation",
    algorithm: "supplied",
    input: true,
    source: { kind: "operation", id: "supplied" },
    samples: result.state.surface.active.length,
    channels: Object.keys(result.state.surface.channels),
    footprint,
    spaceId: result.state.surface.scope.spaceId,
  });
  domain.numerical.captured = result.state.surface;
  domain.scope = { ...domain.scope, areaId, footprint };
  const surface = createGrid("child", domain.scope, 4, 4);
  resampleChannels(result.state.surface, surface);
  const state: GenerationState = { domain, surface, facts: new Set(), history: [] };
  const work = createAtlasWorkspace(state, "draft");
  expect(work.inherited).toBe(true);
  expect(Array.from(work.map.ImpactExcavation).some((value) => value > 0)).toBe(true);
  expect(Array.from(work.map.Elevation).every(Number.isFinite)).toBe(true);
  expect(work.map.SeaLevelInitialized).toBe(true);
  const prepared = prepareRegionalRefinement(domain, {
    ...input,
    areaId,
    domains: ["physical", "magic"],
    features: { "physical.impacts": { enabled: false } },
  });
  expect(
    sequenceStages(prepared.input.configuration!.sequence).map((stage) => stage.invocation?.process)
  ).not.toContain("atlas.impact-cratering");
  expect(prepared.input.configuration!.sequence.some((step) => step.kind === "epochs")).toBe(false);
  expect(prepared.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(state.domain.world.epochs).toEqual(before.world.epochs);
  expect(comparableSnapshot(parent)).toEqual(comparableSnapshot(before));
});

it("explains missing captured geography without scheduling child geological history", () => {
  const { source, input } = constructedWorld(),
    areaId = crypto.randomUUID();
  mapChild(source, input.areaId, rectangle([2200, 100, 3800, 900]), areaId);
  const prepared = prepareRegionalRefinement(source, { ...input, areaId });
  expect(prepared.diagnostics).toContainEqual(
    expect.objectContaining({ code: "regional_parent", severity: "error" })
  );
  expect(prepared.input.configuration!.sequence.some((step) => step.kind === "epochs")).toBe(false);
});

it("refuses to generate a child area that is not an independent map", () => {
  const { source, input } = constructedWorld(),
    areaId = crypto.randomUUID();
  source.world.areas[areaId] = {
    ...source.world.areas[input.areaId],
    id: areaId,
    parentId: input.areaId,
    profile: "region",
    footprint: rectangle([2200, 100, 3800, 900]),
  };
  expect(() => prepareAtlasGeneration(source, { ...input, areaId })).toThrow(/Capture the region/);
});
