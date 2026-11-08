import { rockKindOfCode, type RockFacts, type RockKind } from "./rockCatalogue";
import type { MaterialLayer } from "./rockColumn";

/** A reused visitor view; retain material, a scalar snapshot, when a later comparison needs it. */
export interface GroundLayer {
  /** Dominant constituent identity, for categorical questions only. */
  kind: RockKind;
  /** Effective strength in this medium; loose clasts are less cohesive than their intact source. */
  strength: number;
  /** Visited interval, which may include the whole loose cover or underlying crust. */
  thickness: number;
  /** Both constituents, damage, fabric and surviving ages at this depth. */
  material: Readonly<MaterialLayer>;
}
export interface GroundHere {
  tree: number;
  grass: number;
  wetland: number;
  fire: number;
  fracture: number;
  ward: number;
  stiffening: number;
}
type Visit<T> = (sofar: T, layer: GroundLayer, here: GroundHere) => T;
/** A caller-owned question, independent of which processes made the material. */
export interface GroundQuery<T> {
  readonly start: T;
  readonly soil?: Visit<T>;
  readonly loose?: Visit<T>;
  readonly ice?: Visit<T>;
  readonly rock?: Visit<T>;
  readonly crust?: Visit<T>;
  readonly throughColumn?: boolean;
  /** Without a reducer, categorical questions use the dominant occupied facet. */
  readonly acrossFacets?: (land: T, cut: T, cutShare: number) => T;
}
/** Evaluate each occupied facet before averaging its response over the cell area. */
export function averageGroundQuery(query: GroundQuery<number>): GroundQuery<number> {
  return { ...query, acrossFacets: (land, cut, share) => land * (1 - share) + cut * share };
}
/** Catalogue facts mix by retained constituent share; strength is the altered local value. */
export function materialFact(material: Readonly<MaterialLayer>, fact: keyof RockFacts) {
  if (fact === "resistance") return material.strength;
  const primary = rockKindOfCode(material.kind)[fact],
    secondary = rockKindOfCode(material.secondaryKind)[fact];
  return primary + (secondary - primary) * material.secondaryShare;
}
/** A query's effective facts; raw material retains the source bed's intact properties and record. */
export function groundFact(layer: GroundLayer, fact: keyof RockFacts) {
  return fact === "resistance" ? layer.strength : materialFact(layer.material, fact);
}
