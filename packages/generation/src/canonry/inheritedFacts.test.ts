import { expect, it } from "vitest";
import { inheritedNativeFacts } from "./inheritedFacts";

it("does not treat unprovided climate or event histories as inherited geography", () => {
  const elevation = inheritedNativeFacts(["elevation"]);
  expect(elevation).toContain("LandscapeHistory");
  expect(elevation).toContain("Geothermal"); // Explicitly initialized inert substrate.
  expect(elevation).not.toContain("Impacts");
  expect(elevation).not.toContain("Validated");
  expect(inheritedNativeFacts(["glacialErosion"])).not.toContain("GlacialEvolution");
  expect(inheritedNativeFacts(["glacialErosion", "glacialDeposition"])).toContain(
    "GlacialEvolution"
  );
});
