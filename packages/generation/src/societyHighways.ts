import type { SocietyCommunity, SocietyConnection, SocietyPolity } from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { nearestSample } from "./societySpatial";
import { dryLand } from "./societySupport";
import { wayClasses, wornCost } from "./societyWays";

/**
 * Grand highways are built, not worn. A strong polity raises one along a way its traffic has
 * already made a road, from its seat to one of its towns, when the straight line between the
 * two runs over open, low country: the road then takes the straight shot. The conditions make
 * them rare; a polity keeps at most a few, and a highway outlives the polity that built it.
 */

/** Yearly travellers a way needs before a polity considers paving it. */
const highwayTraffic = wayClasses.road * 1.5;
/** The share of its people a polity must feed to afford great works. */
const highwaySupport = 0.6;
/** Political capacity (an era variable) below which no highway is raised. */
const highwayCapacity = 1;
/** A polity's highways at one time. */
const highwaysPerPolity = 2;
/** Open country: samples along the line within this relief, below this slope and tree cover. */
const openCountry = { relief: 150, slope: 0.02, trees: 0.5, samples: 24 };

function openLine(state: GenerationState, a: SocietyCommunity, b: SocietyCommunity) {
  const { channels } = state.surface;
  let low = Infinity,
    high = -Infinity;
  for (let s = 0; s <= openCountry.samples; s++) {
    const t = s / openCountry.samples,
      i = nearestSample(state, {
        x: a.position.x + (b.position.x - a.position.x) * t,
        y: a.position.y + (b.position.y - a.position.y) * t,
      });
    if (i < 0 || !dryLand(state, i)) return false;
    if ((channels.slope?.[i] ?? 0) > openCountry.slope) return false;
    if ((channels.treeCover?.[i] ?? 0) > openCountry.trees) return false;
    const z = channels.elevation[i];
    low = Math.min(low, z);
    high = Math.max(high, z);
  }
  return high - low <= openCountry.relief;
}
function polityOf(state: GenerationState, id: string) {
  const politics = state.society!.region.politics;
  const owner = politics?.control[id];
  return politics?.polities.find((p) => p.id === owner && p.status === "active");
}
/** A way busy enough to pave, on land, not yet a highway. */
function busyWay(link: SocietyConnection) {
  return (
    !link.highway &&
    link.kind !== "sea" &&
    link.kind !== "door" &&
    (link.wear ?? 0) >= highwayTraffic
  );
}
/** The polity that holds both ends of a way from its seat, if it can afford a highway. */
function builder(
  state: GenerationState,
  link: SocietyConnection,
  built: Map<string, number>,
  capacity: number
): SocietyPolity | undefined {
  const polity = polityOf(state, link.from);
  if (!polity || polityOf(state, link.to) !== polity) return undefined;
  if (polity.seat !== link.from && polity.seat !== link.to) return undefined;
  const able = polity.support >= highwaySupport && capacity >= highwayCapacity;
  return able && (built.get(polity.id) ?? 0) < highwaysPerPolity ? polity : undefined;
}
function count(built: Map<string, number>, polity: string) {
  built.set(polity, (built.get(polity) ?? 0) + 1);
}
function highwaysBuilt(connections: readonly SocietyConnection[]) {
  const built = new Map<string, number>();
  for (const link of connections) if (link.highway) count(built, link.highway.polity);
  return built;
}
/** The era's political capacity and name, as the epoch loop binds them. */
function eraOf(context: MapProcessContext) {
  const epoch = context.epochs.at(-1);
  return {
    capacity: Number(epoch?.variables.politicalCapacity ?? 1),
    era: epoch?.id ?? "Settlement",
  };
}
function raiseHighway(
  state: GenerationState,
  link: SocietyConnection,
  polity: SocietyPolity,
  ends: [SocietyCommunity, SocietyCommunity],
  era: string
) {
  const name = `${state.domain.world.entities[polity.id]?.name ?? polity.id} Way`;
  const year = Math.round(state.society!.cycle?.elapsed ?? 0);
  link.highway = { polity: polity.id, built: `${era}, year ${year}`, name };
  link.travelCost = wornCost(link);
  polity.causes.push(
    `${era}: raised the ${name}, a straight highway from ${ends[0].name} to ${ends[1].name} across open country.`
  );
}
/** Raise the highways the cycle's conditions allow; returns how many were raised. */
export function raiseHighways(state: GenerationState, context: MapProcessContext) {
  const region = state.society!.region;
  if (!region.politics) return 0;
  const { capacity, era } = eraOf(context);
  const communities = new Map(region.communities.map((c) => [c.id, c]));
  const built = highwaysBuilt(region.connections);
  let raised = 0;
  for (const link of region.connections.filter(busyWay)) {
    const polity = builder(state, link, built, capacity);
    const ends: [SocietyCommunity, SocietyCommunity] = [
      communities.get(link.from)!,
      communities.get(link.to)!,
    ];
    if (!polity || !openLine(state, ...ends)) continue;
    raiseHighway(state, link, polity, ends, era);
    count(built, polity.id);
    raised++;
  }
  if (raised) recordHighways(context, region.connections, raised, era);
  return raised;
}
function recordHighways(
  context: MapProcessContext,
  connections: readonly SocietyConnection[],
  raised: number,
  era: string
) {
  context.recordCause({
    kind: "domain",
    process: "human.highways",
    subjects: connections.flatMap((l) => (l.highway ? [l.highway.name] : [])),
    description: `${era}: ${raised} highway${raised === 1 ? "" : "s"} raised where a strong polity's busiest road crosses open country.`,
  });
}
