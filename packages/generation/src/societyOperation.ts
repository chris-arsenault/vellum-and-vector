import type { MapInput } from "./processTraits";

/** A nested society cycle supplies its actual elapsed years, independently of its enclosing era. */
export interface SocietyInput extends MapInput {
  readonly years: number;
  readonly publish?: boolean;
}
