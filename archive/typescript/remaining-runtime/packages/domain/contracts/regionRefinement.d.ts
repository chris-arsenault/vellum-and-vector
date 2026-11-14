import type { Area, World } from "./model";
/** Refinement adds a representation to an existing subject, never a second region tree. */
export declare function refinedRegionArea(world: World, regionId: string): Area | undefined;
export declare function regionRefinementParent(world: World, regionId: string): Area;
export declare function regionRefinementLevel(world: World, regionId: string): number;
/** Leave room around the subject for coastlines and nearby context to develop on this map. */
export declare function regionMapFootprint(
  world: Pick<World, "reference">,
  subject: Area["footprint"]
): import("geojson").Geometry;
export declare function regionRefinementInput(
  world: World,
  regionId: string
): {
  regionId: string;
  parentId: string;
  name: string;
  profile: "region";
  footprint: import("geojson").Geometry;
  frame: {
    origin: import("./model").Position;
    rotation: number;
    metresPerUnit: number;
    floor: string | null;
  };
  context: string;
  approach: "procedural";
  traits: never[];
};
export declare function validateRegionRefinement(world: World, area: Area): void;
