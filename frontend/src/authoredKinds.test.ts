import { describe, expect, it } from "vitest";
import {
  drawChoiceForTool,
  groupKinds,
  kindEntries,
  kindGeometry,
  pushRecent,
  resolveKeys,
  searchKinds,
  toggleFavourite,
} from "./authoredKinds";
import { authoredMap } from "./testSupport/authoredMap";

const entries = kindEntries(authoredMap);

describe("the kind catalogue", () => {
  it("lists every kind of every vector layer and leaves out hexes", () => {
    expect(entries.map((entry) => entry.kind).sort()).toEqual([
      "city",
      "island",
      "landmass",
      "mountain-range",
      "plot",
      "river",
      "stream",
      "village",
    ]);
  });
  it("suggests the geometry the catalogue lists", () => {
    expect(kindGeometry(["Point"])).toBe("Point");
    expect(kindGeometry(["MultiLineString"])).toBe("LineString");
    expect(kindGeometry(["MultiPolygon"])).toBe("Polygon");
    expect(kindGeometry([])).toBe("Polygon");
    expect(entries.find((entry) => entry.kind === "city")?.geometry).toBe("Point");
  });
});
describe("kind search and grouping", () => {
  it("matches every word against label, kind, path and layer", () => {
    expect(searchKinds(entries, "settlements").map((e) => e.kind)).toEqual(["city", "village"]);
    expect(searchKinds(entries, "land coast").map((e) => e.kind)).toEqual(["landmass", "island"]);
    expect(searchKinds(entries, "zzz")).toEqual([]);
    expect(searchKinds(entries, "  ")).toBe(entries);
  });
  it("ranks a label that starts with the word before one that only contains it", () => {
    expect(searchKinds(entries, "land")[0].kind).toBe("landmass");
    expect(searchKinds(entries, "range")[0].kind).toBe("mountain-range");
  });
  it("files kinds under the first step of their path, alphabetically", () => {
    const groups = groupKinds(entries);
    expect(groups.map((group) => group.name)).toEqual(["Land", "Parcels", "Places", "Water"]);
    expect(groups[0].entries.map((e) => e.label)).toEqual(["Island", "Landmass", "Mountain range"]);
  });
});
describe("recent and favourite kinds", () => {
  it("keeps the newest first, without repeats, up to the limit", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b"], "z", 2)).toEqual(["z", "a"]);
  });
  it("toggles favourites and drops keys the map no longer has", () => {
    expect(toggleFavourite(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFavourite(["a", "b"], "a")).toEqual(["b"]);
    const city = entries.find((e) => e.kind === "city")!;
    expect(resolveKeys(["gone", city.key], entries)).toEqual([city]);
  });
});
describe("what each tool draws", () => {
  it("draws the landmass and river kinds with their geometry", () => {
    expect(drawChoiceForTool("landmass", entries, null, null)).toMatchObject({
      layerId: "vector:landmasses",
      kind: "landmass",
      geometry: "Polygon",
    });
    expect(drawChoiceForTool("river", entries, null, null)).toMatchObject({
      layerId: "vector:rivers",
      kind: "river",
      geometry: "LineString",
    });
  });
  it("draws a plot as a polygon into the plots layer", () => {
    expect(drawChoiceForTool("plot", entries, null, null)).toMatchObject({
      layerId: "vector:plots",
      kind: "plot",
      geometry: "Polygon",
    });
  });
  it("draws the armed kind with Place and nothing when none is armed", () => {
    const city = entries.find((e) => e.kind === "city")!;
    expect(drawChoiceForTool("place", entries, city.key, null)).toMatchObject({
      layerId: "vector:settlements",
      kind: "city",
      geometry: "Point",
    });
    expect(drawChoiceForTool("place", entries, null, null)).toBeNull();
  });
  it("keeps the typed name across tools and the held choice for terrain tools", () => {
    const held = { layerId: "x", kind: "y", name: "Orm", width: 1 };
    expect(drawChoiceForTool("landmass", entries, null, held)?.name).toBe("Orm");
    expect(drawChoiceForTool("raise", entries, null, held)).toBe(held);
  });
});
