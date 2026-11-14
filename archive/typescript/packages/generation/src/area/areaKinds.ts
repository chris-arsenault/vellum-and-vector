/**
 * The kinds of area. An area's identity is its extent rather than a spot: it can be a line or a
 * network as well as a region. Each kind has one entry; the POI catalogue's area-shaped kinds
 * (biomes, lakes, ridges, valleys and the like) join this list as they move.
 */
export const areaKindIds = [
  "river",
  "fault",
  "ocean",
  "range",
  "road",
  "lane",
  "polity",
  "politicalRegion",
] as const;
export type AreaKindId = (typeof areaKindIds)[number];
