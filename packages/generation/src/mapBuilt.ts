import { spatial, rectangle } from "@atlas/domain";
import { generatedFeature, putGenerated } from "./mapFeatures";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import { publishSettlements } from "./societyPublication";
import { initializePopulation } from "./societyPopulation";

export const builtProcess: MapProcess = {
  contract: {
    id: "built.layout",
    version: "1",
    parameters: {},
    requires: [],
    produces: ["built"],
    invalidates: [],
  },
  behavior: {
    kind: "extract",
    extract(state, context) {
      context.progress(0, "Laying out settlements and structures");
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
  },
  validate() {
    return [];
  },
};
function settlements(state: GenerationState, context: MapProcessContext) {
  if (!state.society) initializePopulation(state, context);
  publishSettlements(state, context);
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
