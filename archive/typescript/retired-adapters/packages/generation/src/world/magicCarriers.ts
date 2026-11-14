import type { PhysicalField } from "./field";

export type CarrierCosts = Partial<
  Record<"crust" | "roots" | "river" | "wind" | "ice", Float64Array>
>;
// hpc-exempt: one accessor per workspace; the costs themselves are dense typed arrays.
const costs = new WeakMap<PhysicalField, () => CarrierCosts | undefined>();
export const bindCarrierCosts = (map: PhysicalField, read: () => CarrierCosts | undefined) =>
  costs.set(map, read);
/** Blocked material stays in its present carrier. A place cost and a ward cannot multiply the same barrier. */
export function carrierPassage(
  map: PhysicalField,
  carrier: "river" | "wind" | "ice",
  target: number
) {
  if (target < 0) return 0;
  const ward = map.Warding.get(target),
    admitted = ward >= 0.5 ? 0 : 1 - ward,
    cost = costs.get(map)?.()?.[carrier]?.[target] ?? 1;
  return Math.min(admitted, cost > 0 ? Math.min(1, 1 / cost) : 1);
}
