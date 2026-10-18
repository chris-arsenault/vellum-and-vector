import { gridPosition, spatial, rectangle, type Position } from "@atlas/domain";
import { generatedFeature, putGenerated, putGeneratedNetwork } from "./mapFeatures";
import { findRoute } from "./mapRouting";
import { landCells, suitability } from "./mapPeople";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";

export const builtProcess: MapProcess = {
  contract: {
    id: "built.layout",
    version: "1",
    parameters: {},
    requires: [],
    produces: ["built"],
    invalidates: [],
  },
  apply(state, context) {
    const area = state.domain.world.areas[state.domain.scope.areaId];
    if (area.profile === "interior") interior(state);
    else if (area.profile === "site") site(state);
    else settlements(state, context);
    context.recordCause({
      kind: "domain",
      process: "built.layout",
      subjects: [],
      description:
        area.profile === "interior"
          ? "Rooms, connecting doors, walls and furnishings occupy this located floor."
          : "Settlement and structure placement follows the requested area's geography and available habitable land.",
    });
  },
  validate() {
    return [];
  },
};
function settlements(state: GenerationState, context: MapProcessContext) {
  const cells = landCells(state)
    .map((i) => ({ i, value: suitability(state, i) * (0.8 + context.random() * 0.2) }))
    .sort((a, b) => b.value - a.value);
  const points: Position[] = [];
  const grid = state.surface;
  const distance = Math.min(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]) / 6;
  for (const { i } of cells) {
    const p = gridPosition(grid, i);
    if (points.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < distance)) continue;
    const name = `${["Alder", "Stone", "Willow", "High", "Grey", "West", "Green", "North"][points.length]}${["haven", "ford", "mere", "watch"][Math.floor(context.random() * 4)]}`;
    putGenerated(
      state,
      generatedFeature(
        state,
        `settlement:${points.length}`,
        name,
        "settlement",
        "settlements",
        { type: "Point", coordinates: [p.x, p.y] },
        { elevation: grid.channels.elevation[i] }
      )
    );
    points.push(p);
    if (points.length === 8) break;
  }
  for (let i = 1; i < points.length; i++) {
    const target = points
      .slice(0, i)
      .sort(
        (a, b) =>
          Math.hypot(a.x - points[i].x, a.y - points[i].y) -
          Math.hypot(b.x - points[i].x, b.y - points[i].y)
      )[0];
    const path = findRoute(grid, points[i], target, "road");
    if (!path.length) continue;
    putGeneratedNetwork(
      state,
      generatedFeature(state, `road:${i}`, `Road ${i}`, "road", "roads", {
        type: "LineString",
        coordinates: path.map((p) => [p.x, p.y]),
      })
    );
  }
}
function site(state: GenerationState) {
  const [x0, y0, x1, y1] = state.surface.bounds;
  const dx = (x1 - x0) / 5,
    dy = (y1 - y0) / 5;
  for (let y = 1; y <= 3; y++)
    for (let x = 1; x <= 3; x++) {
      const shape = rectangle([
        x0 + x * dx - dx * 0.3,
        y0 + y * dy - dy * 0.3,
        x0 + x * dx + dx * 0.3,
        y0 + y * dy + dy * 0.3,
      ]);
      if (!spatial.covers(state.surface.scope.footprint, shape)) continue;
      putGenerated(
        state,
        generatedFeature(
          state,
          `building:${x}:${y}`,
          x === 2 && y === 2 ? "The Wayfarer's Rest" : `Building ${x + (y - 1) * 3}`,
          "building",
          "structures",
          shape
        )
      );
    }
}
function interior(state: GenerationState) {
  const [x0, y0, x1, y1] = state.surface.bounds;
  const width = x1 - x0,
    height = y1 - y0;
  const inset = Math.min(width, height) * 0.03,
    middle = x0 + width * 0.6;
  const footprints = [
    rectangle([x0 + inset, y0 + inset, middle, y1 - inset]),
    rectangle([middle, y0 + inset, x1 - inset, y1 - inset]),
  ];
  const existing = Object.values(state.domain.world.features).filter(
    (f) => f.areaId === state.domain.scope.areaId && f.kind === "room"
  );
  const rooms = existing.length
    ? existing
    : footprints.flatMap((shape, index) => {
        if (!spatial.covers(state.surface.scope.footprint, shape)) return [];
        const room = generatedFeature(
          state,
          `room:${index}`,
          index ? "Private room" : "Common room",
          "room",
          "structures",
          shape
        );
        putGenerated(state, room);
        return [room];
      });
  const door = generatedFeature(state, "door:joining", "Connecting door", "door", "structures", {
    type: "Point",
    coordinates: [middle, (y0 + y1) / 2],
  });
  door.relations = rooms.map((room) => ({ targetId: room.id, kind: "connects" }));
  if (!existing.length && spatial.covers(state.surface.scope.footprint, door.geometry))
    putGenerated(state, door);
  for (const room of rooms) {
    const [a, b, c, d] = spatial.bounds(room.geometry);
    const table = generatedFeature(
      state,
      `table:${room.id}`,
      "Table",
      "furniture",
      "structures",
      rectangle([a + (c - a) * 0.35, b + (d - b) * 0.35, a + (c - a) * 0.6, b + (d - b) * 0.6])
    );
    table.relations = [{ targetId: room.id, kind: "inside" }];
    putGenerated(state, table);
    const wall = generatedFeature(
      state,
      `wall:${room.id}`,
      `${room.name} walls`,
      "wall",
      "structures",
      {
        type: "LineString",
        coordinates: room.geometry.type === "Polygon" ? room.geometry.coordinates[0] : [],
      }
    );
    putGenerated(state, wall);
  }
}
