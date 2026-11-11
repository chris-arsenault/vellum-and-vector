import { expect, it } from "vitest";
import { absentInheritedHistories, inheritedProducts } from "./inheritedFacts";

it("counts a band as inherited only when a channel carried it, and the ground under a surface", () => {
  const elevation = inheritedProducts(["Elevation"]);
  expect(elevation).toContain("field:Elevation");
  expect(elevation).toContain("field:RockKindCodes");
  expect(elevation).toContain("field:Geothermal"); // Explicitly initialized inert substrate.
  expect(elevation).toContain("field:IceThickness"); // Empty initial band, not a glacial history.
  expect(elevation).not.toContain("field:MaximumIceThickness");
  expect(inheritedProducts(["IceThickness"])).toContain("field:IceThickness");
  expect(elevation).not.toContain("field:ImpactExcavation");
  expect(inheritedProducts(["ImpactExcavation"])).toContain("field:ImpactExcavation");
});
it("holds a history its channels did not fully carry as nothing having happened", () => {
  expect(absentInheritedHistories([])).toEqual([]);
  const partial = absentInheritedHistories(["Elevation", "CumulativeGlacialErosion"]);
  expect(partial).toContain("GlacialEvolution");
  expect(partial).toContain("Impacts");
  expect(
    absentInheritedHistories([
      "Elevation",
      "CumulativeGlacialErosion",
      "CumulativeGlacialDeposition",
    ])
  ).not.toContain("GlacialEvolution");
});
