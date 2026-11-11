import type { PhysicalField } from "../world/field";

/**
 * A step between two cells that do not touch. The going is from each cell to its neighbours;
 * whoever can join two far cells offers the step here, and everything that travels the land
 * takes it like any other, without knowing who made it.
 */
export interface Link {
  readonly a: number;
  readonly b: number;
  /** What the step costs, in metres of open level ground; it is taken either way. */
  readonly cost: number;
}
interface Offer {
  readonly by: string;
  readonly links: (map: PhysicalField) => readonly Link[];
}
const offers: Offer[] = [];
/** Join the going: these steps exist wherever the offerer says they do. Returns its withdrawal. */
export function offerLinks(by: string, links: Offer["links"]) {
  const offer = { by, links };
  offers.push(offer);
  return () => {
    offers.splice(offers.indexOf(offer), 1);
  };
}
/** Every step on a map between cells that do not touch. */
export const linksOf = (map: PhysicalField): Link[] =>
  offers.flatMap((offer) => [...offer.links(map)]);
