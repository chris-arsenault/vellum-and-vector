import { expect, it } from "vitest";
import { absentInheritedHistories, inheritedProducts } from "./inheritedFacts";

it("counts a band as inherited only when a channel carried it, and the ground under a surface", () => {
  const elevation = inheritedProducts(["elevation"]);
  expect(elevation).toContain("field:Elevation");
  expect(elevation).toContain("field:RockKindCodes");
  expect(elevation).toContain("field:Geothermal"); // Explicitly initialized inert substrate.
  expect(elevation).not.toContain("field:ImpactExcavation");
  expect(inheritedProducts(["impactExcavation"])).toContain("field:ImpactExcavation");
});
it("holds a history its channels did not fully carry as nothing having happened", () => {
  expect(absentInheritedHistories([])).toEqual([]);
  const partial = absentInheritedHistories(["elevation", "glacialErosion"]);
  expect(partial).toContain("GlacialEvolution");
  expect(partial).toContain("Impacts");
  expect(
    absentInheritedHistories(["elevation", "glacialErosion", "glacialDeposition"])
  ).not.toContain("GlacialEvolution");
});
