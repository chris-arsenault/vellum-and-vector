import { readFeature, readScene, fixtureState, undoWorld } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import {
  mappedGenerationConflicts,
  proceduralSnapshot,
  restoreMappedEdits,
  presentAtlasFeature,
  rectangle,
  representationId,
} from "@atlas/domain";
import { prepareAtlasGeneration } from "@atlas/generation";
import { mapEditingFixture } from "./mapEditingFixture";
import { snapshotCopy } from "./testSupport/snapshotCopy";

function selected(
  f: Awaited<ReturnType<typeof mapEditingFixture>>,
  box: [number, number, number, number]
) {
  const snapshot = snapshotCopy(f.current());
  snapshot.world.areas[f.child].footprint = rectangle(box);
  return mappedGenerationConflicts(snapshot, f.child);
}
async function editTown(f: Awaited<ReturnType<typeof mapEditingFixture>>, x: number, y: number) {
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...(await readFeature(f.id, f.town, f.child)),
      geometry: { type: "Point", coordinates: [x, y] },
    },
  });
}

it("protects old/new town locations and attached routes while leaving untouched geography refinable", async () => {
  const f = await mapEditingFixture();
  await editTown(f, 550, 450);
  expect(selected(f, [490, 490, 510, 510]).map((edit) => edit.subjectId)).toContain(f.town);
  expect(selected(f, [540, 440, 560, 460]).map((edit) => edit.subjectId)).toContain(f.town);
  expect(selected(f, [590, 540, 610, 560]).map((edit) => edit.subjectId)).toContain(f.road);
  expect(selected(f, [210, 600, 300, 700])).toEqual([]);
  expect(mappedGenerationConflicts(f.current(), f.root)).not.toEqual([]);
  await undoWorld(f.id, fixtureState(f.id).history[0].operationId);
  expect(mappedGenerationConflicts(f.current(), f.root)).toEqual([]);
});

it("keeps renamed fine geometry eligible and retains its original procedural representation", async () => {
  const f = await mapEditingFixture(),
    source = f.current().world.features[f.town];
  source.detail[f.child] = {
    id: representationId(f.id, f.town, f.child),
    geometry: { type: "Point", coordinates: [520, 480] },
    attributes: { ...source.attributes, population: 4900 },
    state: "generated",
    actor: "generator",
    generationId: null,
    protected: false,
    needsReconciliation: false,
  };
  const original = structuredClone(source.detail[f.child]);
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...(await readFeature(f.id, f.town, f.child)),
      name: "Renamed town",
      attributes: { ...original.attributes, nameStatus: "proper" },
    },
  });
  expect(mappedGenerationConflicts(f.current(), f.root)).toEqual([]);
  expect(proceduralSnapshot(f.current()).world.features[f.town].detail[f.child]).toEqual(original);
  await editTown(f, 550, 450);
  expect(selected(f, [510, 470, 530, 490]).map((edit) => edit.subjectId)).toContain(f.town);
  expect(proceduralSnapshot(f.current()).world.features[f.town].detail[f.child]).toEqual(original);
});

it("retains cosmetic edits while allowing newly generated fine geometry and attributes to appear", async () => {
  const f = await mapEditingFixture();
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...(await readFeature(f.id, f.town, f.child)),
      name: "Named town",
      attributes: {
        ...(await readFeature(f.id, f.town, f.child)).attributes,
        nameStatus: "proper",
      },
    },
  });
  const candidate = proceduralSnapshot(f.current()),
    town = candidate.world.features[f.town];
  town.detail[f.child] = {
    geometry: { type: "Point", coordinates: [520, 480] },
    attributes: { ...town.attributes, population: 4900 },
    state: "generated",
    actor: "generator",
    generationId: null,
    protected: false,
    needsReconciliation: false,
  };
  restoreMappedEdits(candidate, f.current());
  const visible = presentAtlasFeature(candidate.world, town, f.child)!;
  expect(visible.geometry).toEqual({ type: "Point", coordinates: [520, 480] });
  expect(visible.attributes).toMatchObject({ population: 4900, nameStatus: "proper" });
  expect(mappedGenerationConflicts(candidate, f.root)).toEqual([]);
  expect(proceduralSnapshot(candidate).world.features[f.town].detail[f.child].geometry).toEqual(
    visible.geometry
  );
});

it("treats changed geographic attributes as structural and releases a restored drawing", async () => {
  const f = await mapEditingFixture(),
    before = await readFeature(f.id, f.town, f.child);
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: { ...before, attributes: { ...before.attributes, population: 7000 } },
  });
  expect(selected(f, [490, 490, 510, 510]).map((edit) => edit.subjectId)).toContain(f.town);
  await f.command("putMapFeature", { areaId: f.child, feature: before });
  expect(mappedGenerationConflicts(f.current(), f.root)).toEqual([]);
});

it("renames a feature with a surrounding footprint without treating local clipping as a structural edit", async () => {
  const f = await mapEditingFixture();
  f.current().world.features[f.town].footprint = rectangle([100, 100, 900, 900]);
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...(await readFeature(f.id, f.town, f.child)),
      name: "Renamed footprint",
      footprint: rectangle([200, 200, 800, 800]),
    },
  });
  expect(mappedGenerationConflicts(f.current(), f.root)).toEqual([]);
});

it("keeps visual layer styling eligible and applies edit footprints at arbitrary descendant depth", async () => {
  const f = await mapEditingFixture();
  await f.command("putLayer", { ...f.current().world.layers.settlements, color: "#ff00ff" });
  expect(mappedGenerationConflicts(f.current(), f.root)).toEqual([]);
  await editTown(f, 550, 450);
  const snapshot = snapshotCopy(f.current()),
    nested = crypto.randomUUID();
  snapshot.world.areas[nested] = {
    ...snapshot.world.areas[f.child],
    id: nested,
    parentId: f.child,
    footprint: rectangle([210, 600, 300, 700]),
  };
  expect(mappedGenerationConflicts(snapshot, nested)).toEqual([]);
  snapshot.world.areas[nested].footprint = rectangle([540, 440, 560, 460]);
  expect(mappedGenerationConflicts(snapshot, nested).map((edit) => edit.subjectId)).toContain(
    f.town
  );
});

it("uses actual brush footprints, excludes unrelated located spaces and restores eligibility on undo", async () => {
  const f = await mapEditingFixture();
  await f.command("paintMapField", {
    areaId: f.child,
    channel: "elevation",
    center: { x: 400, y: 400, z: 0 },
    radius: 100,
    mode: "add",
    amount: 100,
  });
  expect(selected(f, [390, 390, 410, 410])[0].name).toBe("elevation painting");
  // Inside the brush envelope but outside its circular support.
  expect(selected(f, [301, 301, 310, 310])).toEqual([]);
  const snapshot = snapshotCopy(f.current());
  snapshot.world.areas[f.child].spaceId = "independent-space";
  expect(mappedGenerationConflicts(snapshot, f.root)).toEqual([]);
  await undoWorld(f.id, fixtureState(f.id).history[0].operationId);
  expect(mappedGenerationConflicts(f.current(), f.root)).toEqual([]);
});

it("explains the mapped edits that prevent overlapping generation", async () => {
  const f = await mapEditingFixture();
  await editTown(f, 550, 450);
  const input = { areaId: f.child, quality: "draft", seed: 17, domains: ["physical"] };
  const errors = prepareAtlasGeneration(f.current(), input).diagnostics.filter(
    (diagnostic) => diagnostic.code === "mapped_edit_overlap"
  );
  expect(
    errors.some(
      (error) => error.message.includes("Known town") && error.message.includes("Geographic region")
    )
  ).toBe(true);
});

it("hides an existing feature only on its edited map and retains source context and undo", async () => {
  const f = await mapEditingFixture(),
    before = snapshotCopy(f.current());
  await f.command("deleteMapFeature", { areaId: f.child, featureId: f.town });
  expect((await readScene(f.id, f.child)).some((feature) => feature.id === f.town)).toBe(false);
  expect((await readScene(f.id, f.root)).some((feature) => feature.id === f.town)).toBe(true);
  expect(proceduralSnapshot(f.current()).world.features).toEqual(before.world.features);
  expect(selected(f, [490, 490, 510, 510]).map((edit) => edit.subjectId)).toContain(f.town);
  await undoWorld(f.id, fixtureState(f.id).history[0].operationId);
  expect((await readScene(f.id, f.child)).some((feature) => feature.id === f.town)).toBe(true);
  expect(mappedGenerationConflicts(f.current(), f.root)).toEqual([]);
});

it("protects a new drawing's current location and releases it when removed", async () => {
  const f = await mapEditingFixture(),
    id = crypto.randomUUID();
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      id,
      name: "New town",
      kind: "settlement",
      layerId: "settlements",
      geometry: { type: "Point", coordinates: [300, 300] },
      attributes: { population: 100 },
      relations: [],
    },
  });
  expect(selected(f, [290, 290, 310, 310]).map((edit) => edit.subjectId)).toContain(id);
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...(await readFeature(f.id, id, f.child)),
      geometry: { type: "Point", coordinates: [350, 300] },
    },
  });
  expect(selected(f, [290, 290, 310, 310])).toEqual([]);
  expect(selected(f, [340, 290, 360, 310]).map((edit) => edit.subjectId)).toContain(id);
  await f.command("deleteMapFeature", { areaId: f.child, featureId: id });
  expect(mappedGenerationConflicts(f.current(), f.root)).toEqual([]);
  expect(proceduralSnapshot(f.current()).world.features[id]).toBeUndefined();
});

it("keeps a changed mapped relationship out of procedural input and classifies it as structural", async () => {
  const f = await mapEditingFixture(),
    before = snapshotCopy(f.current());
  await f.command("putMapFeature", {
    areaId: f.root,
    feature: {
      ...(await readFeature(f.id, f.town, f.root)),
      relations: [{ targetId: f.road, kind: "served-by" }],
    },
  });
  expect(mappedGenerationConflicts(f.current(), f.child).map((edit) => edit.subjectId)).toContain(
    f.town
  );
  expect(proceduralSnapshot(f.current()).world.features[f.town].relations).toEqual(
    before.world.features[f.town].relations
  );
  const candidate = proceduralSnapshot(f.current());
  restoreMappedEdits(candidate, f.current());
  expect(candidate.world.features[f.town].relations).toEqual([
    { targetId: f.road, kind: "served-by" },
  ]);
  expect(mappedGenerationConflicts(candidate, f.child).map((edit) => edit.subjectId)).toContain(
    f.town
  );
});
