import type { Area, State, World } from "./model";
export interface MaterializedCoverage {
  id: string;
  areaId: string;
  spaceId: string;
  layerId: string;
  detailRank: number;
  resolution: number | null;
  time: string;
  footprint: Area["footprint"];
  state: State;
  resourceId: string | null;
  generationId: string | null;
}
export declare function validateCoverage(
  world: Pick<World, "id" | "areas" | "reference">,
  coverage: MaterializedCoverage,
  existing: MaterializedCoverage[]
): void;
