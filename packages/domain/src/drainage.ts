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
  /** Owned present river state, independent of the cartographic reach records. */
  kept?: RetainedRiverNetwork;
  /** Captured parent context waiting to be resolved on this map's own lattice. */
  input?: boolean;
}

/** A saved map retains its rivers, including their dry beds and former courses. */
export interface RetainedRiverNetwork {
  next: number;
  reaches: RetainedRiver[];
  entries: { position: [number, number]; monthly: number[]; catchment: number }[];
}
export interface RetainedRiver {
  id: number;
  course: [number, number][];
  downstream: number | null;
  order: number;
  flow: number;
  least: number;
  flood: number;
  months: number;
  dry: boolean;
  drawn: boolean;
  driedIn?: number;
  former: { course: [number, number][]; leftIn: number }[];
  monthly: number[];
  catchment: number[];
  bed: number[];
  width: number[];
  depth: number[];
  leakage: number[];
  river?: string;
  record?: string;
  name?: string;
}
