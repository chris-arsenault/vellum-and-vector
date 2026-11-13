import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { waterColumn } from "@atlas/domain";
import { source, sourceFiles } from "../architectureReach";

/**
 * What a river is, and what a cell's water is (ADR 0014). These checks
 * were written failing, before the code met them, and are not loosened to pass.
 *
 * - A cell holds quantities of water. It is never itself "a river".
 * - A river is a reach: a record kept in the map's state from pass to pass.
 * - What exists on a map is decided by sizes declared against the map (ADR 0005: "relative
 *   declarations resolved by the shared MapScale"; "a per-map cell minimum alone would name
 *   every resolved fragment of a finer map").
 * - Snow, soil water, groundwater and standing water are one package.
 *
 * The owner's direction of 2026-11-12: an actual column of water and rivers as things, not
 * memory marks on cells; sizes follow the scale and latent contracts. The implementing
 * lines and behavior tests are listed in ownerDirections.architecture.ts.
 */
const files = () => [...sourceFiles(source)].map((path) => relative(source, path));
const text = (path: string) => readFileSync(join(source, path), "utf8");
function lines(paths: string[], pattern: RegExp) {
  return paths.flatMap((path) =>
    text(path)
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}`] : []))
  );
}
const fixtures = /Fixtures?\.ts$/;

describe("a river's size comes from the map", () => {
  it("decides no river, channel or divide by a count of cells", () => {
    // The places that say where water makes a river or a valley.
    const deciding = files().filter(
      (path) =>
        path.startsWith("water/") ||
        ["regional/network.ts", "regional/divides.ts", "regional/relief.ts"].includes(path)
    );
    expect(lines(deciding, /\b\w*(Cells|Catchments)\s*=\s*\d/)).toEqual([]);
  });
  it("judges a river's flow against a size of the map, not the size of a cell", () => {
    expect(lines(["water/rivers.ts", "water/riverSize.ts"], /mesh\.area\(0\)|cellArea/)).toEqual(
      []
    );
  });
  it("declares what makes a river once, against the map, for everything that asks", () => {
    // One place states the sizes, through MapScale; the river network, a region's starting
    // network and the test for drawing a river all take them from there.
    const declared = existsSync(join(source, "water/riverSize.ts"))
      ? text("water/riverSize.ts")
      : "";
    expect(declared).toMatch(/MapScale\.volume\(/);
    expect(declared).toMatch(/MapScale\.area\(/);
    for (const user of ["water/rivers.ts", "regional/network.ts", "worldSignificance.ts"])
      expect(text(user), user).toMatch(/from "(\.\.?\/)+(water\/)?riverSize"/);
  });
});

describe("a cell is never a river", () => {
  it("does not construct the owned network from a raster river classification", () => {
    expect(
      lines(
        ["water/rivers.ts", "water/riverKeeping.ts"],
        /cutReaches|keepReaches|buildChannels|noteMonth/
      )
    ).toEqual([]);
  });
  it("routes retained courses before gathering water and projects cells after changing reaches", () => {
    expect(text("water/routing.ts")).toContain("retainRiverRoutes(map)");
    const algorithm = text("water/rivers.ts");
    expect(algorithm.indexOf("advanceReaches(map.rivers")).toBeLessThan(
      algorithm.indexOf("projectRivers(map)")
    );
    expect(text("water/reachEvolution.ts")).not.toMatch(/RiverOrders|FlowingMonths|cutReaches/);
  });
  it("conditions actual river floors rather than averaged terrain heights", () => {
    expect(lines(["water/drainageFlood.ts"], /map\.Elevation\.get\(/)).toEqual([]);
  });
  it("lets nothing outside the water code read the river mark on cells", () => {
    const outside = files().filter((path) => !path.startsWith("water/") && !fixtures.test(path));
    expect(
      lines(outside, /\.(RiverOrders|RiverMemory|RiverWidth|RiverDepth|FlowingMonths)\b/)
    ).toEqual([]);
  });
  it("lets nothing outside the water code name the river mark as something it reads", () => {
    // Where the layer is declared, published and given to the water processes is not a read.
    const declarations = [
        "coupling/quantities.ts",
        "world/atlasChannels.ts",
        "processes/waterProcesses.ts",
      ],
      outside = files().filter(
        (path) => !path.startsWith("water/") && !declarations.includes(path) && !fixtures.test(path)
      );
    expect(lines(outside, /["'](RiverOrders|RiverMemory)["']/)).toEqual([]);
  });
  it("keeps reaches in the map's state: publishing does not derive them", () => {
    expect(lines(["area/riverCourses.ts", "area/riverPublish.ts"], /drainageReaches\(/)).toEqual(
      []
    );
  });
});

describe("the water column is one package", () => {
  // The column is a cell's snow, soil water, groundwater and standing water (with what kind
  // of water stands and which body it is). What the ground remembers is not part of it.
  const column = waterColumn as Record<string, string | undefined>,
    parts = ["snow", "soil", "ground", "standing", "surface", "kind", "body"].map(
      (part) => column[part]
    );
  it("holds lying snow with the rest of a cell's water, as a layer of the map", () => {
    expect(parts.every(Boolean), "every part names a layer").toBe(true);
    // The map's layers are declared by name in the domain package.
    const layers = readFileSync(join(source, "../../domain/src/physicalFields.ts"), "utf8");
    expect(layers).toContain(`"${column.snow}",`);
  });
  it("writes a column's parts only through the package", () => {
    const writes = new RegExp(
        `\\b(${parts.filter(Boolean).join("|")})\\b\\s*\\)?\\s*\\.(set|add|fill|copyFrom)\\(`
      ),
      elsewhere = files().filter((path) => path !== "water/column.ts" && !fixtures.test(path));
    expect(existsSync(join(source, "water/column.ts")), "the package exists").toBe(true);
    expect(lines(elsewhere, writes)).toEqual([]);
  });
  it("hands the column to a finer map as the package, not layer by layer", () => {
    // What a finer map inherits of water is listed by the package and taken from it whole.
    expect(text("world/atlasChannels.ts")).toMatch(/waterColumnChannels/);
    for (const part of parts.filter(Boolean))
      expect(
        lines(["world/atlasChannels.ts"], new RegExp(`\\(["']${part}["']`)),
        `${part} is not published on its own`
      ).toEqual([]);
  });
});
