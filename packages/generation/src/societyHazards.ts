import {
  mergePopulation,
  population,
  semanticId,
  type SocietyCommunity,
  type SocietyEvent,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { nearestSample } from "./societySpatial";
import { societyValue } from "./societySupport";
import { magicAt } from "./societyMagic";
import { isWorldSociety } from "./societyMapScope";
import { fieldInterpolator } from "@atlas/domain";

interface Exposure {
  kind: string;
  rate: number;
  severity: number;
  radius: number;
  cause: string;
}
function exposures(state: GenerationState, c: SocietyCommunity): Exposure[] {
  const i = nearestSample(state, c.position),
    v = (name: string) => societyValue(state, name, i);
  const fire = magicAt(state, "fracture", i),
    aurora = magicAt(state, "cold-drainage", i),
    pressure = magicAt(state, "ocean-rays", i);
  return [...physicalExposures(v), ...magicalExposures(fire, aurora, pressure, v)];
}
function physicalExposures(v: (name: string) => number): Exposure[] {
  return [
    {
      kind: "avalanche",
      rate: v("slope") > 0.15 && v("iceThickness") > 1 ? 0.002 : 0,
      severity: 0.5,
      radius: 1500,
      cause: "Snow-bearing steep terrain released downslope.",
    },
    {
      kind: "flood",
      rate: v("floodFrequency") * 0.02,
      severity: 0.12,
      radius: 5000,
      cause: "River flood frequency and exposed settlement terrain.",
    },
    {
      kind: "tsunami",
      rate: v("elevation") < 20 && v("oceanDistance") < 10000 ? v("tectonicStrain") * 0.00001 : 0,
      severity: 0.4,
      radius: 10000,
      cause: "An active coastal strain zone triggered marine inundation.",
    },
  ];
}
function magicalExposures(
  fire: number,
  aurora: number,
  pressure: number,
  v: (name: string) => number
): Exposure[] {
  return [
    {
      kind: "thermal-fracture",
      rate: fire > 0.26 && aurora > 0.34 ? 0.001 : 0,
      severity: 0.3,
      radius: 2000,
      cause: "Fire heat met Aurora-bearing ice, producing a thermal fracture.",
    },
    {
      kind: "steam-fracture",
      rate: fire > 0.39 && pressure > 0.42 && v("fracture") > 0.52 ? 0.002 : 0,
      severity: 0.4,
      radius: 3000,
      cause: "Ocean Pressure entered conductive Fire fractures.",
    },
    {
      kind: "pressure-ice-breach",
      rate: pressure > 0.39 && aurora > 0.43 && v("iceThickness") > 20 ? 0.002 : 0,
      severity: 0.4,
      radius: 5000,
      cause: "Pressure reached charged coastal ice.",
    },
  ];
}
function relocateSurvivors(state: GenerationState, source: SocietyCommunity, fraction: number) {
  const region = state.society!.region;
  const neighbors = new Set(
    region.connections.flatMap((l) =>
      l.from === source.id ? [l.to] : l.to === source.id ? [l.from] : []
    )
  );
  const target = region.communities
    .filter((c) => neighbors.has(c.id) && !c.protected && c.status === "inhabited")
    .sort((a, b) => b.support.capacity - population(b) - (a.support.capacity - population(a)))[0];
  if (!target) return 0;
  const migrants = source.groups.map((g) => ({ ...g, count: g.count * fraction }));
  const moved = migrants.reduce((sum, g) => sum + g.count, 0);
  source.groups = source.groups.map((g) => ({ ...g, count: g.count * (1 - fraction) }));
  target.groups = mergePopulation([...target.groups, ...migrants]);
  target.causes.push(`Received ${Math.round(moved)} displaced people from ${source.name}.`);
  return moved;
}
export function applySocietyEvent(state: GenerationState, event: SocietyEvent) {
  const region = state.society!.region;
  if (region.events.some((e) => e.id === event.id)) return;
  for (const c of region.communities) {
    const distance = Math.hypot(c.position.x - event.position.x, c.position.y - event.position.y);
    if (distance > event.radius || c.protected || !terrainExposure(state, event, c)) continue;
    const severity = Math.min(
      1,
      Math.max(0, event.magnitude * (1 - distance / Math.max(1, event.radius)))
    );
    const casualties = population(c) * severity * 0.2;
    for (const g of c.groups) g.count *= 1 - severity * 0.2;
    if (c.settlement) c.settlement.population *= (1 - severity * 0.2) * (1 - severity * 0.6);
    event.casualties += casualties;
    event.displaced += relocateSurvivors(state, c, severity * 0.6);
    event.communities.push(c.id);
    c.causes.push(`${event.era}: ${event.kind}; ${Math.round(casualties)} casualties.`);
    if (severity > 0.7) c.status = "ruined";
    damageWorks(state, c.id, severity);
  }
  region.events.push(event);
  const record = region.history.at(-1);
  if (record) {
    record.deaths += event.casualties;
    record.after -= event.casualties;
    record.causes.push(...event.causes);
  }
}
function damageWorks(state: GenerationState, id: string, severity: number) {
  for (const work of state.society!.region.works)
    if (work.communityId === id) work.condition *= 1 - severity;
}
export function resolveSocietyHazards(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  if (state.society!.inherited) return;
  const era = context.epochs.at(-1)?.id ?? "Settlement";
  applyAuthoredHazards(state, era);
  for (const c of state.society!.region.communities)
    for (const exposure of exposures(state, c)) {
      if (context.random() >= 1 - Math.exp(-exposure.rate * years)) continue;
      const event: SocietyEvent = {
        id: semanticId(
          state.domain.world.id,
          "society-event",
          `${era}:${state.society!.cycle?.index ?? 0}:${c.id}:${exposure.kind}`
        ),
        era,
        kind: exposure.kind,
        position: c.position,
        // At World a hazard is a rate on the unit and its footprint is the unit's; a point
        // radius of a few kilometres only has meaning on a finer mesh (ADR 0005).
        radius: isWorldSociety(state) ? unitRadius(c) : exposure.radius,
        magnitude: exposure.severity * (0.5 + context.random() * 1.5),
        casualties: 0,
        displaced: 0,
        communities: [],
        causes: [exposure.cause],
      };
      applySocietyEvent(state, event);
    }
  context.recordCause({
    kind: "domain",
    process: "human.hazards",
    subjects: [],
    description:
      "New triggered disturbances affect exposed people and works once; survivors retain their identities and travel along surviving connections.",
  });
}
/** The radius of a circle with the unit's country, in metres. */
export function unitRadius(c: Pick<SocietyCommunity, "areaKm2">) {
  return Math.sqrt((c.areaKm2 * 1e6) / Math.PI);
}
function applyAuthoredHazards(state: GenerationState, era: string) {
  for (const f of Object.values(state.domain.world.features)) {
    if (
      f.kind !== "societyEvent" ||
      f.state === "generated" ||
      f.attributes.era !== era ||
      f.geometry.type !== "Point"
    )
      continue;
    if (f.attributes.eventKind === "collapse") continue;
    const magnitude = Number(f.attributes.magnitude ?? 0.5),
      radius = Number(f.attributes.radius ?? 1000);
    if (!validHazard(magnitude, radius)) continue;
    applySocietyEvent(state, {
      id: f.id,
      era,
      kind: String(f.attributes.eventKind),
      position: { x: f.geometry.coordinates[0], y: f.geometry.coordinates[1], z: 0 },
      radius,
      magnitude,
      casualties: 0,
      displaced: 0,
      communities: [],
      causes: [`Creator-authored ${f.name} in ${era}.`],
    });
  }
}
function validHazard(magnitude: number, radius: number) {
  return Number.isFinite(magnitude) && magnitude >= 0 && Number.isFinite(radius) && radius > 0;
}

function terrainExposure(state: GenerationState, event: SocietyEvent, c: SocietyCommunity) {
  if (!["avalanche", "tsunami", "flood"].includes(event.kind)) return true;
  const height = fieldInterpolator(state.surface, "elevation");
  const start = height(event.position);
  const ceiling = event.kind === "tsunami" ? 20 : start + (event.kind === "flood" ? 5 : 0);
  const distance = Math.hypot(c.position.x - event.position.x, c.position.y - event.position.y);
  const steps = Math.max(
    1,
    Math.ceil(distance / Math.max(1, state.surface.scope.resolution ?? 1000))
  );
  for (let n = 0; n <= steps; n++) {
    const t = n / steps;
    if (
      height({
        x: event.position.x + (c.position.x - event.position.x) * t,
        y: event.position.y + (c.position.y - event.position.y) * t,
        z: 0,
      }) > ceiling
    )
      return false;
  }
  return true;
}
