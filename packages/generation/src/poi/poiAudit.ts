import { spatial, type AtlasFeature, type DrainageReach } from "@atlas/domain";
import { nativePosition } from "../world/atlasWorkspace";
import { riversOf } from "../area/riverCourses";
import { continuingRivers } from "../area/riverLineage";
import { riverCourseJudgments, type CourseJudgment } from "../world/worldRiverCourses";
import type { RegionalState } from "../regional/state";
import { generationFeatures } from "../generationFeatures";
import { onRiver, waterAt } from "../water/riverKeeping";
import type { GenerationState } from "../process";
import { mapScale, riverShortfalls } from "../worldSignificance";
import { poiCatalogue } from "./catalogue";
import type { PoiEntry } from "./poiContract";
import { originsOf } from "./poiOrigins";
import { carryOutcomes, placesOf } from "./poiPublish";
import { groundOf } from "../rock/ground";
import { surfaceResistance } from "../rock/groundQueries";
import { cellSpan, featureCell, fieldOf, gap, isLand, releaseHeld, rockKindAt } from "./poiReads";
import { stepsOf } from "./water/waterfallOrigins";

/**
 * What a run decided about its places and why, read off the finished state. It changes nothing.
 * A report reads this rather than inferring a cause from counts on the map.
 */

/** Within this many cells of a drawn river, a fall is on it. */
const onRiverCells = 1.5;

const tally = (values: readonly string[]) => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};
const mapFeatures = (state: GenerationState) => [
  ...generationFeatures(state, { areaId: state.domain.scope.areaId }),
];
const originOf = (feature: AtlasFeature) => String(feature.attributes.origin ?? "none recorded");

/** From why a place might exist to what the map shows, per origin, for a kind declaring origins. */
function kindFunnel(state: GenerationState, entry: PoiEntry, features: readonly AtlasFeature[]) {
  const found = (entry.existence.places as (s: GenerationState) => readonly { origin?: string }[])(
      state
    ),
    realized = placesOf(state, entry),
    published = features.filter((feature) => feature.attributes.poi === entry.id);
  return {
    claimed: tally(found.map((place) => String(place.origin))),
    realized: tally(realized.map((place) => String(place.origin))),
    published: tally(published.map(originOf)),
  };
}

interface RiverRecord {
  reach: DrainageReach;
  index: number;
  judged?: CourseJudgment;
}
/** Which reach and course each channel cell belongs to, as river publication formed them. */
function riverRecords(state: GenerationState) {
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`,
    reaches = state.domain.world.drainage?.[state.domain.scope.areaId]?.reaches ?? [],
    judgments = riverCourseJudgments(reaches, mapScale(state)),
    courseOf = new Map(
      judgments.flatMap((judged) => judged.course.map((i) => [i, judged] as const))
    ),
    records = new Map<string, RiverRecord>();
  // A reach's last point is the next reach's first: the reach a cell flows on through owns it.
  reaches.forEach((reach, index) =>
    reach.coordinates.slice(0, -1).forEach(([x, y]) => {
      records.set(key(x, y), { reach, index, judged: courseOf.get(index) });
    })
  );
  // A reach that ends on land ends at its own last point: no other reach flows on through it.
  reaches.forEach((reach, index) => {
    const [x, y] = reach.coordinates.at(-1)!;
    if (!records.has(key(x, y)))
      records.set(key(x, y), { reach, index, judged: courseOf.get(index) });
  });
  return {
    judgments,
    at(cell: number) {
      const p = nativePosition(state.physical!, cell);
      return records.get(key(p.x, p.y));
    },
  };
}
type Rivers = ReturnType<typeof riverRecords>;

const drawnDistance = (
  state: GenerationState,
  rivers: readonly AtlasFeature[],
  place: AtlasFeature
) =>
  rivers.reduce(
    (nearest, river) => Math.min(nearest, spatial.distance(river.geometry, place.geometry)),
    Infinity
  ) / cellSpan(state);

function standing(onChannel: boolean, cells: number, record: RiverRecord | undefined) {
  if (cells <= onRiverCells) return "on a drawn river";
  if (!onChannel) return "no channel at its cell";
  if (!record) return "channel in no reach";
  return record.judged?.publish ? "on a mapped course, not drawn there" : "on a latent channel";
}
/** The channel and course under a cell, or nothing where the cell is off this map's lattice. */
function channelAt(state: GenerationState, cell: number, rivers: Rivers) {
  if (cell < 0) return { onChannel: false, discharge: null, record: undefined };
  const map = fieldOf(state);
  return {
    onChannel: onRiver(map, cell),
    discharge: waterAt(map, cell),
    record: rivers.at(cell),
  };
}
/** Where one published place stands against every definition of a river. */
function riverAccount(
  state: GenerationState,
  place: AtlasFeature,
  drawn: readonly AtlasFeature[],
  rivers: Rivers
) {
  const cell = featureCell(state, place),
    { onChannel, discharge, record } = channelAt(state, cell, rivers),
    cells = drawnDistance(state, drawn, place),
    judged = record?.judged;
  return {
    name: place.name,
    origin: originOf(place),
    cell,
    onChannel,
    distanceToDrawnRiverCells: cells,
    standing: standing(onChannel, cells, record),
    discharge,
    trueSize: place.attributes.trueSize ?? null,
    members: place.attributes.members ?? null,
    courseEvidence: judged?.evidence ?? null,
    courseFails: judged ? riverShortfalls(judged.evidence, mapScale(state)) : null,
  };
}
/** The kinds said to stand on a river, and how many of each do. */
const riverKinds = ["riverMouth", "ford", "bridge", "mill", "dam", "irrigation", "gorge"];
function riverStanding(
  state: GenerationState,
  features: readonly AtlasFeature[],
  drawn: readonly AtlasFeature[],
  rivers: Rivers
) {
  return Object.fromEntries(
    riverKinds.map((kind) => [
      kind,
      tally(
        features
          .filter((feature) => feature.attributes.poi === kind)
          .map((feature) => riverAccount(state, feature, drawn, rivers).standing)
      ),
    ])
  );
}
/** Every step in a river, and which definition of a river it stands on. */
function stepAccount(state: GenerationState, rivers: Rivers, fallCells: ReadonlySet<number>) {
  const on = stepsOf(state).map((cell) => {
    const record = rivers.at(cell),
      where = !record ? "in no reach" : record.judged?.publish ? "mapped course" : "latent channel";
    return { where, fall: fallCells.has(cell) };
  });
  return {
    steps: tally(on.map(({ where }) => where)),
    falls: tally(on.filter(({ fall }) => fall).map(({ where }) => where)),
  };
}
/** Each published fall's standing, and how much of the river network the map draws. */
function auditFalls(state: GenerationState, features: readonly AtlasFeature[]) {
  const drawn = features.filter((feature) => feature.kind === "river"),
    falls = features.filter((feature) => feature.kind === "waterfall"),
    rivers = riverRecords(state),
    accounts = falls.map((fall) => riverAccount(state, fall, drawn, rivers)),
    scale = mapScale(state);
  return {
    linkedToTheirRiver: falls.filter((fall) => fall.attributes.hostedBy).length,
    standing: tally(accounts.map((account) => account.standing)),
    standingByOrigin: tally(accounts.map(({ origin, standing: s }) => `${origin}: ${s}`)),
    stepsAndFalls: stepAccount(state, rivers, new Set(accounts.map(({ cell }) => cell))),
    courses: {
      total: rivers.judgments.length,
      mapped: rivers.judgments.filter((judged) => judged.publish).length,
      failing: tally(rivers.judgments.flatMap((judged) => riverShortfalls(judged.evidence, scale))),
    },
    otherKinds: riverStanding(state, features, drawn, rivers),
    falls: accounts,
  };
}

/** What the water does after a river's last land cell. */
function endOf(state: GenerationState, cell: number) {
  const map = fieldOf(state),
    next = map.FlowTargets.get(cell);
  if (next < 0) return map.mesh.membership(cell) === 1 ? "drains no further" : "leaves the frame";
  return ["joins land", "sea", "lake"][map.WaterKindCodes.get(next)] ?? "other water";
}
/** Every river of this map: where it came from, how long it runs and what stands on it. */
function riverAudit(state: GenerationState, features: readonly AtlasFeature[]) {
  const continued = "regional" in state ? continuingRivers(state as RegionalState) : [],
    parents = new Map(continued.map((river) => [river.id, river])),
    hosted = features.filter((feature) => feature.attributes.hostedBy),
    onRiver = (id: string) =>
      hosted.filter((f) => (f.attributes.hostedBy as { hostId: string }).hostId === id).length;
  return {
    parentsOnThisMap: continued.length,
    placesRecordingARiver: tally(hosted.map((f) => String(f.attributes.poi))),
    list: riversOf(state).map(({ id, cells }) => ({
      id,
      fromParent: parents.has(id),
      share: parents.has(id) ? [parents.get(id)!.from, parents.get(id)!.to] : null,
      parentCellsHere: parents.get(id)?.course.cells.length ?? null,
      cells: cells.length,
      endFromParentEndCells: parents.has(id)
        ? gap(state, cells[cells.length - 1], parents.get(id)!.course.cells.at(-1)!) /
          cellSpan(state)
        : null,
      endsIn: endOf(state, cells[cells.length - 1]),
      drawnAs: features.filter((f) => f.kind === "river" && f.attributes.riverId === id).length,
      places: onRiver(id),
      name: parents.get(id)?.course.feature.name ?? null,
    })),
  };
}

/** How many land cells each rock kind holds, and the range of resistance it was left with. */
function rockAudit(state: GenerationState) {
  const map = fieldOf(state),
    kinds: Record<string, { cells: number; softest: number; hardest: number }> = {};
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (map.mesh.membership(cell) !== 1 || !isLand(state, cell)) continue;
    const resistance = groundOf(map).fold(cell, surfaceResistance),
      name = rockKindAt(state, cell).id,
      entry = (kinds[name] ??= { cells: 0, softest: resistance, hardest: resistance });
    entry.cells++;
    entry.softest = Math.min(entry.softest, resistance);
    entry.hardest = Math.max(entry.hardest, resistance);
  }
  return kinds;
}

/** The account of a finished map, for the run's report. */
export function auditPlaces(state: GenerationState) {
  if (!state.physical) return {};
  releaseHeld(state);
  const features = mapFeatures(state),
    kinds = Object.values(poiCatalogue).filter((entry) => originsOf(entry).length > 0);
  const audit = {
    funnels: Object.fromEntries(
      kinds.map((entry) => [entry.id, kindFunnel(state, entry, features)])
    ),
    waterfall: auditFalls(state, features),
    carried: carryOutcomes(state),
    rivers: riverAudit(state, features),
    rocks: rockAudit(state),
  };
  releaseHeld(state);
  return audit;
}
