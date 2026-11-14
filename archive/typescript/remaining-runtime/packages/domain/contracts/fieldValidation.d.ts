import type { Area, Layer } from "./model";
import type { DomainSnapshot } from "./operations";
import type { Grid } from "./grids";
export declare function fieldFact(layer: Layer, channel: string): string;
export declare function validateAuthoredField(
  snapshot: DomainSnapshot,
  area: Area,
  grid: Grid<string>,
  layer: Layer,
  descendants?: boolean
): void;
