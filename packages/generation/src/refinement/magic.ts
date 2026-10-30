import { fieldPosition, gridPosition, KeyedHeap, type MagicSystem, type Band } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { channel, clamp, distance, neighbors, type RefinementState } from "./state";
import { applyRegionalMeetings } from "./meetings";
import { generationFeatures } from "../generationFeatures";

/** Present effects are locally resolved; this operation never renews or advances a stock. */
export function refineMagic(state: RefinementState) {
  if (!state.input.domains.includes("magic")) return;
  const systems = (state.domain.world.magicSystems ?? []).filter((s) => s.enabled),
    g = state.surface;
  channel(state, "treeCover", "ratio", 0.2);
  const previous = new Map<string, Band>();
  if (systems.some((s) => s.id === "fire")) seedCapturedCores(state);
  for (const system of systems) {
    const intensity = channel(state, `magic:${system.id}:intensity`, "relative-intensity");
    previous.set(system.id, g.coverage.copyBand(intensity));
    resolveMedium(state, system, intensity);
    if (system.id === "fire") spreadFire(state, system, intensity);
    if (system.id === "aurora") coldDrainage(state, intensity);
  }
  wardAndTear(state, systems);
  for (const system of systems) {
    const before = previous.get(system.id)!;
    applyPresentEffects(state, system, before, g.channels[`magic:${system.id}:intensity`]);
    g.coverage.release(before);
  }
  applyRegionalMeetings(state);
}
function seedCapturedCores(state: RefinementState) {
  const g = state.surface,
    source = channel(state, "magic:fire:source", "relative-intensity");
  for (const f of generationFeatures(state, { areaId: state.input.areaId })) {
    if (f.kind !== "fire:core" || f.geometry.type !== "Point") continue;
    const p = fieldPosition(g, {
        x: f.geometry.coordinates[0],
        y: f.geometry.coordinates[1],
        z: 0,
      }),
      { x, y } = p,
      col = Math.round(((x - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1)),
      row = Math.round(((y - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1)),
      i = row * g.width + col;
    if (i < 0 || i >= source.length) continue;
    source.set(i, Math.max(source.get(i), Number(f.attributes.intensity ?? 500)));
  }
}
function resolveMedium(state: RefinementState, system: MagicSystem, intensity: Band) {
  const g = state.surface;
  for (let i = 0; i < intensity.length; i++) {
    const p = gridPosition(g, i),
      texture = fractalNoise(
        p.x,
        p.y,
        state.input.seed ^ system.id.length,
        Math.max((g.scope.resolution ?? 1000) * 4, state.parentSpan / 2),
        3
      ),
      medium = mediumResponse(state, system.id, i, texture);
    intensity.set(i, clamp(intensity.get(i) * medium, 0, 1000));
  }
}
/** Each material responds to its own carrier and local environment. */
const responses: Record<string, (c: Record<string, Band>, i: number, t: number) => number> = {
  fire: (c, i, t) => (c.water.get(i) === 1 ? 0 : 0.7 + c.fracture.get(i) * 0.5 + t * 0.3),
  aurora: (c, i, t) =>
    clamp(0.8 + (c.ice?.get(i) ?? 0) * 0.4 - c.temperature.get(i) / 60 + t * 0.15, 0.1, 1.5),
  pressure: (c, i, t) =>
    c.water.get(i) === 1
      ? clamp(0.7 + Math.log1p(c.waterDepth.get(i) / 1000) * 0.15 + t * 0.25, 0.2, 1.4)
      : 0,
  greenwood: (c, i, t) =>
    c.water.get(i) !== 0 || (c.ice?.get(i) ?? 0) > 0.3 || c.soilDepth.get(i) < 0.1
      ? 0
      : clamp(
          (0.4 + c.treeCover.get(i) + c.moisture.get(i) * 0.4) *
            (1 - clamp(c.slope.get(i) * 3)) *
            (1 + t * 0.2) *
            clamp((c.treeCover.get(i) + (c.grassCover?.get(i) ?? 0)) * 4),
          0,
          1.5
        ),
  salt: (c, i, t) =>
    c.water.get(i) === 1
      ? 0.2
      : clamp(
          1.2 - c.moisture.get(i) * 0.5 + t * 0.15 + (c.sediment?.get(i) ?? 0) * 0.01,
          0.4,
          1.5
        ),
  hallowed: (c, i) => (c.water.get(i) === 0 ? 1 : 0),
  veil: (c, i, t) => (c.water.get(i) === 0 ? 0.8 + c.fracture.get(i) * 0.4 + t * 0.15 : 0),
};
function mediumResponse(state: RefinementState, id: string, i: number, texture: number) {
  return responses[id]?.(state.surface.channels, i, texture) ?? 1;
}
/** Cost-distance along the finer fractures, seeded only by captured sources. */
function spreadFire(state: RefinementState, system: MagicSystem, intensity: Band) {
  const g = state.surface,
    source = g.channels[`magic:${system.id}:source`];
  if (!source) return;
  const front = new KeyedHeap("max"),
    conductance = g.channels.fracture,
    p = system.parameters;
  for (let i = 0; i < source.length; i++)
    if (source.get(i) > intensity.get(i)) {
      intensity.set(i, source.get(i));
      front.push(i, source.get(i));
    }
  while (front.size) {
    const i = front.pop();
    if (front.poppedKey() !== intensity.get(i)) continue;
    for (const j of neighbors(g, i)) {
      if (g.channels.water.get(j) === 1) continue;
      const fracture = (conductance.get(i) + conductance.get(j)) / 2,
        cost =
          ((p.baseCost + ((1 - clamp(fracture)) * 1000) / p.conductanceDivisor) *
            distance(g, i, j)) /
          1000,
        next = intensity.get(i) - cost;
      if (next <= intensity.get(j)) continue;
      intensity.set(j, next);
      front.push(j, next);
    }
  }
}
/** Charge resolves into colder neighboring ice; no fresh aurora rain is generated. */
function coldDrainage(state: RefinementState, intensity: Band) {
  const g = state.surface,
    delta = g.coverage.scratch("float64", "regional:cold-charge", intensity.length);
  for (let i = 0; i < intensity.length; i++) {
    let target = i;
    for (const j of neighbors(g, i))
      if (g.channels.temperature.get(j) < g.channels.temperature.get(target)) target = j;
    if (target === i) continue;
    const moving = intensity.get(i) * 0.15 * (1 - clamp(g.channels.ice?.get(i) ?? 0));
    delta.add(i, -moving);
    delta.add(target, moving);
  }
  for (let i = 0; i < intensity.length; i++)
    intensity.set(i, clamp(intensity.get(i) + delta.get(i), 0, 1000));
  g.coverage.release(delta);
}
function applyPresentEffects(
  state: RefinementState,
  system: MagicSystem,
  previous: Band,
  intensity: Band
) {
  const g = state.surface,
    e = system.effects;
  const effects: [string, number][] = [
    ["quickening", e.quickening],
    ["stillness", e.stillness],
    ["verdure", e.verdure],
    ["salting", e.salting],
    ["warding", e.warding],
    ["tearing", e.tearing],
    ["fog", e.fog],
  ];
  for (const [name, strength] of effects) {
    if (!strength) continue;
    const output = channel(state, name, "ratio");
    for (let i = 0; i < intensity.length; i++)
      output.set(i, clamp((intensity.get(i) / 1000) * strength));
  }
  if (e.heat)
    for (let i = 0; i < intensity.length; i++)
      g.channels.temperature.add(i, ((intensity.get(i) - previous.get(i)) * e.heat) / 10);
}
function wardAndTear(state: RefinementState, systems: MagicSystem[]) {
  const g = state.surface,
    ward = g.channels["magic:hallowed:intensity"],
    veil = g.channels["magic:veil:intensity"],
    fields = systems
      .filter((s) => !["hallowed", "veil"].includes(s.id))
      .map((s) => g.channels[`magic:${s.id}:intensity`]);
  if (ward) for (const field of fields) wardField(state, field, ward);
  if (!veil || fields.length < 2) return;
  for (let i = 0; i < g.active.length; i++) {
    const strain = localStrain(state, fields, i),
      held = clamp((ward?.get(i) ?? 0) / 1000);
    veil.set(i, clamp(Math.max(veil.get(i), strain) * (1 - held), 0, 1000));
  }
}
function localStrain(state: RefinementState, fields: Band[], i: number) {
  let strain = 0;
  for (let a = 0; a < fields.length; a++)
    for (let b = a + 1; b < fields.length; b++) {
      const meeting = Math.min(fields[a].get(i), fields[b].get(i)) / 1000;
      for (const j of neighbors(state.surface, i))
        strain = Math.max(
          strain,
          meeting *
            Math.abs(fields[a].get(i) - fields[b].get(i) - (fields[a].get(j) - fields[b].get(j)))
        );
    }
  return strain;
}
function wardField(state: RefinementState, field: Band, ward: Band) {
  const g = state.surface,
    delta = g.coverage.scratch("float64", "regional:ward-rim", field.length);
  for (let i = 0; i < field.length; i++) {
    const removed = field.get(i) * clamp(ward.get(i) / 1000) * 0.8;
    delta.add(i, -removed);
    const rim = [...neighbors(g, i)].filter((j) => ward.get(j) < ward.get(i));
    for (const j of rim) delta.add(j, removed / rim.length);
  }
  for (let i = 0; i < field.length; i++) field.set(i, clamp(field.get(i) + delta.get(i), 0, 1000));
  g.coverage.release(delta);
}
