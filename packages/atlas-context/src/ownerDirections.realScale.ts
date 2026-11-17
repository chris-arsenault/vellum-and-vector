/** One owner direction carried by the code; see ownerDirections.architecture.ts. */
export interface OwnerDirection {
  /** The direction, in the owner's terms. */
  direction: string;
  given: string;
  /** Files, from the repository root, whose marked line carries the direction. */
  marks: readonly string[];
  /** The test that fails if the behaviour is undone, where one can state it. */
  test?: string | readonly string[];
}

/** The owner's real-scale map directions (ADR 0016). */
export const realScaleDirections: readonly OwnerDirection[] = [
  {
    direction: "replace the previous real scale resolutions with the updated list",
    given: "2026-11-16",
    marks: ["crates/atlas-generation/src/atlas/resolution.rs"],
    test: "crates/atlas-generation/tests/scale_settings.rs",
  },
  {
    direction:
      "no hex lattice; the hex is a representation for resolution built from a triangle sub-lattice",
    given: "2026-11-16",
    marks: ["crates/atlas-generation/src/atlas/resolution.rs"],
    test: "crates/atlas-generation/tests/scale_settings.rs",
  },
  {
    direction: "its time to introduce manual authoring for real scale only",
    given: "2026-11-16",
    marks: ["crates/atlas-map/src/authoring/mod.rs"],
    test: "crates/atlas-gis/tests/authoring.rs",
  },
  {
    direction:
      "when the user is authoring a map goes from the numerically in depth representation to a 2d representation of it",
    given: "2026-11-16",
    marks: ["crates/atlas-map/src/lib.rs"],
    test: "crates/atlas-gis/tests/authoring.rs",
  },
  {
    direction: "dragging a river around preserves the river in tact as a feature line",
    given: "2026-11-16",
    marks: ["crates/atlas-map/src/authoring/plan.rs"],
    test: ["crates/atlas-gis/tests/authoring.rs", "frontend/tests/realScaleAuthoring.test.ts"],
  },
  {
    direction:
      "there are no tools for art generation. we will ship assets that we genrate in development with open ai",
    given: "2026-11-17",
    marks: ["frontend/src/buildingArt.ts"],
    test: "frontend/src/buildingArt.test.ts",
  },
];
