import type { Area, World } from "./model";
export declare function validateAreaPlacement(
  world: Pick<World, "id" | "areas" | "reference">,
  area: Area
): void;
