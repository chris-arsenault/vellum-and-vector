import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Geometry, MapEditing, Position, TerrainOutcome } from "@atlas/map";
import { AuthoredKinds } from "./AuthoredKinds";
import { AuthoredPalette } from "./AuthoredPalette";
import { AuthoredToolOptions } from "./AuthoredTerrainTools";
import { armKind, chooseAuthoredTool, runShortcut, shortcutFor } from "./authoredActions";
import { kindEntries } from "./authoredKinds";
import { buildStroke, terrainEdit } from "./authoredState";
import { drawCommand, streetCommand } from "./drawCommand";
import { drawShape, type AuthoringSession } from "./useRealScaleAuthoring";
import { authoredMap, cityMap } from "./testSupport/authoredMap";
import { defaultAuthored } from "./authoredState";

/** A session as the panel sees it: state, `set`, and the actions. */
function fakeSession(extra: Partial<AuthoringSession> = {}) {
  const session = {
    map: authoredMap,
    state: {
      tool: "select",
      authored: defaultAuthored(authoredMap.bounds),
      draw: null,
      selected: [],
    },
    set(next: object) {
      Object.assign(session.state, next);
    },
    canUndo: true,
    canRedo: true,
    undo: vi.fn(async () => {}),
    redo: vi.fn(async () => {}),
    run: vi.fn(async () => undefined),
    ...extra,
  };
  return session as unknown as AuthoringSession & {
    state: AuthoringSession["state"];
    undo: ReturnType<typeof vi.fn>;
    redo: ReturnType<typeof vi.fn>;
  };
}
const key = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  shortcutFor({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe("drawing on an authored map", () => {
  it("offers every non-hex vector layer for drawing and selection", () => {
    for (const layer of authoredMap.layers.filter((l) => l.source.kind === "vector")) {
      const expected =
        layer.id === "vector:hexes" ? null : layer.id === "vector:rivers" ? "line" : "area";
      expect(drawShape(layer.id, undefined, true)).toBe(expected);
    }
    expect(drawShape("vector:rivers", "river", true)).toBe("line");
  });
  it("keeps real-scale behaviour when the map is not authored", () => {
    expect(drawShape("vector:settlements")).toBeNull();
    expect(drawShape("vector:rivers")).toBe("line");
    expect(drawShape("vector:lakes")).toBe("area");
  });
  it("Landmass then a drawn polygon creates a landmass in the landmasses layer", () => {
    const session = fakeSession();
    chooseAuthoredTool(session, "landmass");
    expect(session.state.tool).toBe("draw");
    session.set({ draw: { ...session.state.draw!, name: "  Orm  " } });
    const ring: Position[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 0],
    ];
    const command = drawCommand(session.state.draw!, { type: "Polygon", coordinates: [ring] }, "");
    expect(command).toMatchObject({
      command: "create",
      layerId: "vector:landmasses",
      kind: "landmass",
      name: "Orm",
      creatorLayer: null,
    });
  });
  it("draws an authored river as a plain line and a real-scale line with widths", () => {
    const session = fakeSession();
    chooseAuthoredTool(session, "river");
    const line: Geometry = {
      type: "LineString",
      coordinates: [
        [0, 0],
        [5, 5],
      ],
    };
    const river = drawCommand(session.state.draw!, line, "");
    expect(river).toMatchObject({ layerId: "vector:rivers", attributes: {} });
    const scaled = drawCommand(
      { layerId: "vector:rivers", kind: "river", name: "", width: 2 },
      line,
      ""
    );
    expect(scaled).toMatchObject({ attributes: { widths: [2, 2] } });
  });
  it("arming a Point kind makes Place draw a point on the map", () => {
    const session = fakeSession();
    armKind(
      session,
      kindEntries(authoredMap).find((e) => e.kind === "village")!
    );
    expect(session.state.tool).toBe("draw");
    expect(session.state.draw).toMatchObject({ kind: "village", geometry: "Point" });
    const point: Geometry = { type: "Point", coordinates: [3, 4] };
    expect(drawCommand(session.state.draw!, point, "")).toMatchObject({
      layerId: "vector:settlements",
      geometry: point,
      attributes: {},
    });
  });
});
describe("city tools", () => {
  it("Draw street issues drawStreet with the chosen class and name", () => {
    const session = fakeSession({ map: cityMap });
    Object.assign(session.state, { town: { roadClass: "mainStreet", use: "house", name: " " } });
    runShortcut(session, key("G")!);
    expect(session.state.tool).toBe("street");
    session.set({ town: { ...session.state.town, roadClass: "alley", name: "Mill Lane" } });
    const line: Geometry = {
      type: "LineString",
      coordinates: [
        [500, 500],
        [900, 500],
      ],
    };
    expect(streetCommand(session.state.town, line, "")).toEqual({
      command: "drawStreet",
      roadClass: "alley",
      geometry: line,
      name: "Mill Lane",
      creatorLayer: null,
    });
  });
  it("shows the street class picker from the town vocabulary and the city group only", () => {
    const session = fakeSession({ map: cityMap });
    Object.assign(session.state, { town: { roadClass: "lane", use: "house", name: "" } });
    chooseAuthoredTool(session, "street");
    const options = renderToStaticMarkup(createElement(AuthoredToolOptions, { session }));
    for (const label of ["Main street", "Lane", "Alley"]) expect(options).toContain(label);
    const palette = renderToStaticMarkup(createElement(AuthoredPalette, { session }));
    expect(palette).toContain("Streets &amp; parcels");
    expect(palette).not.toContain("Elevation");
  });
});
describe("terrain tools", () => {
  it("a brush stroke goes to the service as one stroke edit", async () => {
    const outcome: TerrainOutcome = { rect: null, version: 1, canUndo: true, canRedo: false };
    const editing = { terrain: vi.fn(async () => outcome) } as unknown as MapEditing;
    const session = fakeSession();
    chooseAuthoredTool(session, "raise");
    expect(session.state.tool).toBe("brush");
    const { tool, brush } = session.state.authored;
    expect(tool).toBe("raise");
    const dragged: [number, number][] = [
      [0, 0],
      [4000, 0],
      [8000, 0],
    ];
    await editing.terrain(
      authoredMap.reference,
      terrainEdit.stroke(buildStroke(dragged, "raise", brush))
    );
    expect(editing.terrain).toHaveBeenCalledTimes(1);
    const [, edit] = (editing.terrain as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(edit).toMatchObject({ type: "stroke", value: { mode: "raise", radius: brush.radius } });
  });
});
describe("keyboard", () => {
  it("maps Ctrl or Cmd with Z to undo and with Shift to redo", () => {
    expect(key("z", { ctrlKey: true })).toEqual({ type: "undo" });
    expect(key("Z", { metaKey: true })).toEqual({ type: "undo" });
    expect(key("z", { ctrlKey: true, shiftKey: true })).toEqual({ type: "redo" });
  });
  it("Ctrl+Z calls the session's one undo, which routes by action kind", () => {
    const session = fakeSession();
    runShortcut(session, key("z", { ctrlKey: true })!);
    runShortcut(session, key("z", { ctrlKey: true, shiftKey: true })!);
    expect(session.undo).toHaveBeenCalledTimes(1);
    expect(session.redo).toHaveBeenCalledTimes(1);
  });
  it("does not call undo when there is nothing to undo", () => {
    const session = fakeSession({ canUndo: false });
    runShortcut(session, key("z", { ctrlKey: true })!);
    expect(session.undo).not.toHaveBeenCalled();
  });
  it("picks tools by key and adjusts the brush with brackets", () => {
    const session = fakeSession();
    runShortcut(session, key("R")!);
    expect(session.state.authored.tool).toBe("raise");
    const before = session.state.authored.brush.radius;
    runShortcut(session, key("]")!);
    expect(session.state.authored.brush.radius).toBeCloseTo(before * 1.25);
    expect(key("q")).toBeNull();
  });
});
describe("the panel markup", () => {
  it("groups the tools, shows shortcuts in tooltips and has no hex options", () => {
    const html = renderToStaticMarkup(createElement(AuthoredPalette, { session: fakeSession() }));
    for (const group of ["Edit", "Land", "Elevation", "Water", "Places"])
      expect(html).toContain(`aria-label="${group}"`);
    expect(html).toContain('title="Landmass: Draw a coast (L)"');
    expect(html.toLowerCase()).not.toContain("hex");
  });
  it("lists the catalogue's kinds and no others", () => {
    const html = renderToStaticMarkup(createElement(AuthoredKinds, { session: fakeSession() }));
    for (const label of ["Landmass", "Village", "Mountain range", "Stream"])
      expect(html).toContain(label);
    expect(html).toContain("Search 8 kinds");
    expect(html).not.toContain(">Hex<");
  });
  it("shows brush options for a brush and a name for the landmass tool", () => {
    const session = fakeSession();
    chooseAuthoredTool(session, "flatten");
    let html = renderToStaticMarkup(createElement(AuthoredToolOptions, { session }));
    expect(html).toContain("Radius");
    expect(html).toContain("Strength");
    expect(html).toContain("Height");
    chooseAuthoredTool(session, "landmass");
    html = renderToStaticMarkup(createElement(AuthoredToolOptions, { session }));
    expect(html).toContain("Name");
    expect(html).not.toContain("Strength");
  });
});
