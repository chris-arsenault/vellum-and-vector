import { rectangle } from "@atlas/domain";
import { createWorld, session } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { makeCommand } from "./useAtlas";

export function mapEditingFixture(roadEnd: [number, number] = [650, 650]) {
  const initial = createWorld({ name: "Mapped authoring", seed: 17, width: 1000, height: 1000 });
  const root = Object.keys(initial.areas)[0],
    river = crypto.randomUUID(),
    town = crypto.randomUUID(),
    road = crypto.randomUUID();
  const current = () => session(initial.id).snapshot;
  const command = (kind: string, data: Record<string, unknown>) =>
    commitCommand(initial.id, makeCommand(current().world, kind, data));
  command("createField", { areaId: root, layerId: "elevation", resolution: 11, value: 100 });
  for (const feature of sourceFeatures(river, town, road, roadEnd))
    command("putFeature", {
      areaId: root,
      feature: { ...feature, protected: false, relations: [] },
    });
  command("createArea", {
    parentId: root,
    name: "Geographic region",
    profile: "region",
    footprint: rectangle([200, 200, 800, 800]),
    frame: { ...initial.areas[root].frame, origin: { x: 500, y: 500, z: 0 } },
    traits: [],
    approach: "manual",
    domains: [],
  });
  const child = Object.values(current().world.areas).find((area) => area.parentId === root)!.id;
  return {
    id: initial.id,
    root,
    child,
    river,
    town,
    road,
    current,
    command,
    field: current().world.fields[0].id,
  };
}
function sourceFeatures(river: string, town: string, road: string, roadEnd: [number, number]) {
  return [
    {
      id: river,
      name: "Retained river",
      kind: "river",
      layerId: "rivers",
      geometry: {
        type: "LineString",
        coordinates: [
          [100, 100],
          [500, 500],
          [900, 900],
        ],
      },
      attributes: { elevations: [300, 200, 100], discharges: [10, 10, 10], discharge: 10 },
    },
    {
      id: town,
      name: "Known town",
      kind: "settlement",
      layerId: "settlements",
      geometry: { type: "Point", coordinates: [500, 500] },
      attributes: { communityId: "known", population: 5000 },
    },
    {
      id: road,
      name: "Town way",
      kind: "road",
      layerId: "roads",
      geometry: {
        type: "LineString",
        coordinates: [[500, 500], roadEnd],
      },
      attributes: { fromCommunity: "known", toCommunity: "other" },
    },
  ];
}
