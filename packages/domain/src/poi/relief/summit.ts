import type { PoiEntry, PoiFound, PoiMap } from "../poiTypes";
import { cellsWithin, distance, nearestAbove, placesOf, unit } from "../mapSearch";
import { landPeaks } from "../prominence";

/**
 * A rise of one part in a hundred across a cell is the roughness of the field itself; a top
 * that stands less than that above its key col is not a summit of this map.
 */
const resolvableRise = 0.01;
/** A summit commands the country within this many times its prominence around it. */
const dominanceRatio = 20;
/** Weights of the physical factors; cultural attachment alone can carry a summit. */
const weights = { magnitude: 0.35, contrast: 0.35, isolation: 0.2, orientation: 0.1 };
/** How strongly a settlement's role ties it to the summit above it. */
const roleTies: Record<string, number> = { capital: 1, regionalCapital: 0.7, marketTown: 0.5 };
/** People at which a settlement without a role ties to its summit as strongly as a market town. */
const tiedPopulation = 2000;

type Measure =
  | "elevation"
  | "prominence"
  | "relativeProminence"
  | "isolation"
  | "dominance"
  | "surroundingMean"
  | "surroundingLowest"
  | "surroundingHighest"
  | "view"
  | "commanded";
type Summit = PoiFound<Measure>;

/**
 * The country a summit is seen against, out to twenty times its height above the sea: its
 * mean, lowest and highest ground, and how much of it lies well below the top. A lesser top
 * in a range is judged against the range, not against its own slopes.
 */
function surroundings(map: PoiMap, cell: number, prominence: number) {
  const height = map.read("elevation", cell),
    sea = map.has("seaLevel") ? map.read("seaLevel", cell) : 0,
    view = Math.max(map.cellSpan, (height - sea) * dominanceRatio),
    around = cellsWithin(map, cell, view).filter((other) => other !== cell),
    heights = around.map((other) => map.read("elevation", other));
  if (!heights.length)
    return {
      view,
      surroundingMean: height,
      surroundingLowest: height,
      surroundingHighest: height,
      commanded: 0,
    };
  return {
    view,
    surroundingMean: heights.reduce((sum, h) => sum + h, 0) / heights.length,
    surroundingLowest: Math.min(...heights),
    surroundingHighest: Math.max(...heights),
    commanded: heights.filter((h) => h < height - prominence / 2).length / heights.length,
  };
}

function find(map: PoiMap): Summit[] {
  const higher = (cell: number) =>
    map.neighbours(cell).every((n) => map.read("elevation", n) < map.read("elevation", cell));
  const tops = landPeaks(map).filter(
      (peak) => peak.prominence >= resolvableRise * map.cellSpan && higher(peak.cell)
    ),
    largest = Math.max(1, ...tops.map((peak) => peak.prominence));
  return tops.map(({ cell, prominence }) => {
    const elevation = map.read("elevation", cell);
    return {
      kind: "summit",
      cells: [cell],
      anchor: cell,
      measures: {
        elevation,
        prominence,
        relativeProminence: prominence / largest,
        isolation: nearestAbove(map, cell, "elevation", elevation),
        dominance: Math.max(map.cellSpan, prominence * dominanceRatio),
        ...surroundings(map, cell, prominence),
      },
    };
  });
}

/**
 * Rising above the country it is seen against: its height above that country's mean, over
 * the country's whole relief. Near one over plains; small among higher neighbours.
 */
const contrast = ({ measures: m }: Summit) =>
  unit(
    (m.elevation - m.surroundingMean) /
      Math.max(1, Math.max(m.elevation, m.surroundingHighest) - m.surroundingLowest)
  );
/** Half when the nearest higher ground lies at the edge of the country it commands. */
const isolation = ({ measures: m }: Summit) => unit(m.isolation / (m.isolation + m.dominance));
/** People's tie to it: something named after it, or a settlement within its country. */
function cultural(place: Summit, map: PoiMap) {
  const self = map.places.find((p) => p.kind === "summit" && p.anchor === place.anchor);
  if (self && map.places.some((p) => p.namedAfter === self.id)) return 1;
  let tie = 0;
  for (const town of placesOf(map, ["settlement"])) {
    const reach = distance(map, town.anchor, place.anchor);
    if (reach > place.measures.dominance) continue;
    const role = Math.max(0, ...town.roles.map((r) => roleTies[r] ?? 0)),
      people = town.measures.population ?? 0,
      size = (roleTies.marketTown * people) / (people + tiedPopulation);
    tie = Math.max(tie, Math.max(role, size) * (1 - reach / place.measures.dominance));
  }
  return tie;
}
const factors = {
  magnitude: ({ measures }: Summit) => unit(measures.relativeProminence),
  contrast,
  isolation,
  cultural,
  orientation: ({ measures }: Summit) => unit(measures.commanded),
};

export const summit: PoiEntry<Measure> = {
  status: "drafted",
  id: "summit",
  group: "relief",
  name: "Summit",
  origins: ["natural", "magic"],
  geometry: "point",
  description:
    "A high point of the ground: a top from which the land falls away on every side, from a knoll to a great peak. Its material and how it was raised do not change what it is; a volcanic cone's top is a summit too.",
  formedBy:
    "Uplift, volcanism and magic-driven construction raise the ground; rivers, ice and hillslopes cut it into separate tops.",
  reads: ["elevation", "water", "seaLevel"],
  measures: {
    elevation: { unit: "metre", meaning: "Height of the top." },
    prominence: {
      unit: "metre",
      meaning: "Height above its key col, the highest point on any route to higher ground.",
    },
    relativeProminence: {
      unit: "ratio",
      meaning: "Prominence against the most prominent summit on the map.",
    },
    isolation: { unit: "metre", meaning: "Distance to the nearest higher ground." },
    dominance: {
      unit: "metre",
      meaning:
        "Radius of the ground it rules over: twenty times its prominence; a settlement within it lies at its foot.",
    },
    view: {
      unit: "metre",
      meaning: "Radius of the country it is seen against: twenty times its height above the sea.",
    },
    surroundingMean: { unit: "metre", meaning: "Mean height of the country it is seen against." },
    surroundingLowest: { unit: "metre", meaning: "Lowest ground in that country." },
    surroundingHighest: { unit: "metre", meaning: "Highest ground in that country." },
    commanded: {
      unit: "ratio",
      meaning: "Share of that country lying more than half its prominence below it.",
    },
  },
  identity: {
    statement:
      "A land cell higher than every neighbour whose prominence, its height above its key col, is at least one hundredth of the cell span: a local maximum of elevation the field resolves.",
    find,
  },
  distinctFrom: [
    {
      kind: "pass",
      separatedBy:
        "A summit is a maximum of elevation; a pass is a key col, the minimum along the highest route between two summits.",
      exclusive: true,
    },
    {
      kind: "volcano",
      separatedBy: "A volcano is built by volcanic construction; its top is also a summit.",
      exclusive: false,
    },
    {
      kind: "range",
      separatedBy: "A range is the area of high ground that holds many summits.",
      exclusive: false,
    },
  ],
  visibility: {
    statement:
      "A summit shows by how far it stands above its own country, how alone it stands and how large it is; a settlement named after it or a capital at its foot carries it regardless. A 1500 m top over plains outranks the same top among higher peaks.",
    factors,
    importance: (place, map) =>
      Math.max(
        cultural(place, map),
        weights.magnitude * factors.magnitude(place) +
          weights.contrast * contrast(place) +
          weights.isolation * isolation(place) +
          weights.orientation * factors.orientation(place)
      ),
    extent: (place) => place.measures.dominance,
  },
  shapes: "Nothing: a summit is read from the terrain the processes made.",
  naming:
    "Its own name in the naming culture of the people who live within sight of it; a settlement at its foot may take its name.",
};
