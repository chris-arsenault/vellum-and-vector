/**
 * One generated channel between confluences, ordered source to mouth through cell centres.
 * Each reach ends at the cell its downstream reach starts from, or at its receiving water.
 */
export interface DrainageReach {
  downstream: number | null;
  waterBody: number | null;
  order: number;
  basin: number;
  coordinates: [number, number][];
  discharges: number[];
  catchmentAreas: number[];
  featureIds: string[];
}
/**
 * An area's complete generated channel network. The map shows a filtered subset; finer
 * areas refine from all of it, so smaller rivers can surface without regenerating the parent.
 */
export interface DrainageNetwork {
  areaId: string;
  spaceId: string;
  reaches: DrainageReach[];
}
