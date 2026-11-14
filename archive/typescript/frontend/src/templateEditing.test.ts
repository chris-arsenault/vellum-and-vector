import { expect, it } from "vitest";
import { buildDefinition, detached, editable, itemFromFeature } from "./templateEditing";
import { rectangle, frameAt } from "./presentation";
import type { AtlasFeature, Template } from "./types";

function importedTemplate() {
  const door: AtlasFeature = {
    id: "door",
    areaId: detached,
    name: "Door",
    kind: "door",
    layerId: "structures",
    geometry: { type: "Point", coordinates: [0, 5] },
    attributes: { use: "access" },
    detail: {},
    relations: [{ targetId: "portal", kind: "connects" }],
    state: "authored",
    protected: true,
    actor: "user",
    causes: [],
    generationId: null,
  };
  const portal: AtlasFeature = {
    ...door,
    id: "portal",
    kind: "portal",
    geometry: {
      type: "LineString",
      coordinates: [
        [5, 5],
        [10, 5],
      ],
    },
    relations: [],
  };
  const template: Template = {
    id: "definition",
    name: "Imported",
    footprint: rectangle(0, 0, 20, 15),
    frame: frameAt(0, 0),
    profile: "interior",
    parentProfiles: ["site"],
    features: [door, portal],
    traits: [],
    sockets: [
      {
        id: "required-entry",
        featureId: door.id,
        kind: "entrance",
        position: { x: 0, y: 5, z: 0 },
        required: true,
        targetKinds: ["entrance"],
      },
      {
        id: "portal-link",
        featureId: portal.id,
        kind: "portal",
        position: { x: 5, y: 5, z: 0 },
        required: true,
        targetKinds: ["portal"],
      },
    ],
  };
  return template;
}
it("preserves required sockets, unsupported access geometry and relations through a rename", () => {
  const template = importedTemplate();
  const [door, portal] = template.features;
  const form = new FormData();
  form.set("name", "Renamed");
  form.set("owner", "");
  form.set("use", "access");
  const result = buildDefinition(
    form,
    {
      items: template.features.filter(editable).map(itemFromFeature),
      floors: [{ id: detached, name: "Ground", z: 0 }],
      size: { width: 20, height: 15 },
      units: "metre",
    },
    template
  );
  expect(result.name).toBe("Renamed");
  expect(result.sockets).toEqual(template.sockets);
  expect(result.features).toEqual(template.features);
  const unbound = {
    ...template,
    sockets: template.sockets!.map((s) =>
      s.featureId === door.id ? { ...s, required: false } : s
    ),
  };
  form.set("bindAccess", "on");
  const bound = buildDefinition(
    form,
    {
      items: unbound.features.filter(editable).map(itemFromFeature),
      floors: [{ id: detached, name: "Ground", z: 0 }],
      size: { width: 20, height: 15 },
      units: "metre",
    },
    unbound
  );
  expect(bound.sockets!.find((s) => s.featureId === door.id)!.required).toBe(true);
  expect(bound.sockets!.find((s) => s.featureId === portal.id)).toEqual(template.sockets![1]);
});
