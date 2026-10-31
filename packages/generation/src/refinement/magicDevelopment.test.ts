import { expect, it } from "vitest";
import { canonryMagicPresets, gridPosition } from "@atlas/domain";
import { regionalEnvironment } from "./refinementFixture";
import { channel } from "./state";
import { developRegionalAurora, developRegionalPressure } from "./magicWater";
import { developRegionalGreenwood, developRegionalHallowed } from "./magicLand";
import { developRegionalSalt } from "./magicSalt";
import { developRegionalVeil } from "./magicVeil";
import { refineMagic } from "./magic";
import { classifyRegionalMagic } from "./magicCartography";
import { putRefinementFeature } from "./features";

function environment(id: string, level = 2) {
  const f = regionalEnvironment(level);
  f.state.domain.world.magicSystems = canonryMagicPresets().map((s) => ({
    ...s,
    enabled: s.id === id,
  }));
  f.state.domain.world.confluences = [];
  const system = f.state.domain.world.magicSystems.find((s) => s.id === id)!,
    intensity = channel(f.state, `magic:${id}:intensity`, "relative-intensity");
  return { ...f, g: f.state.surface, system, intensity };
}

it("develops charged ice deposits and retains weaker relict charge on thawed ground", () => {
  const frozen = environment("aurora"),
    thawed = environment("aurora");
  for (const f of [frozen, thawed]) {
    const stock = channel(f.state, "magic:aurora:stock:field/ice", "intensity-square-metre");
    for (let i = 0; i < stock.length; i++) stock.set(i, f.g.measures.get(i) * 1000);
    f.g.channels.ice.fill(f === frozen ? 1 : 0);
    f.g.channels.temperature.fill(f === frozen ? -20 : 15);
    developRegionalAurora(f.state, f.system, f.intensity);
  }
  expect(Math.max(...frozen.intensity)).toBeGreaterThan(Math.max(...thawed.intensity));
  expect(Array.from(frozen.g.channels["magic:aurora:stock:field/ice"]).some((v) => v === 0)).toBe(
    true
  );
  expect(Array.from(thawed.g.channels["magic:aurora:stock:field/ground"]).some((v) => v > 0)).toBe(
    true
  );
  expect(Array.from(thawed.g.channels["magic:aurora:stock:field/ice"]).every((v) => v === 0)).toBe(
    true
  );
});

it("keeps Pressure fronts in their connected ocean and reaches new water when the passage opens", () => {
  const closed = environment("pressure"),
    open = environment("pressure");
  for (const f of [closed, open]) {
    f.g.channels.water.fill(1);
    f.g.channels.waterDepth.fill(2000);
    const middle = Math.floor(f.g.height / 2) * f.g.width,
      source = channel(f.state, "magic:pressure:source", "relative-intensity");
    source.set(middle + 3, 900);
    if (f === closed)
      for (let y = 0; y < f.g.height; y++)
        f.g.channels.water.set(y * f.g.width + Math.floor(f.g.width / 2), 0);
    developRegionalPressure(f.state, f.system, f.intensity);
  }
  const right = Math.floor(closed.g.height / 2) * closed.g.width + closed.g.width - 3;
  expect(closed.intensity.get(right)).toBe(0);
  expect(open.intensity.get(right)).toBeGreaterThan(0);
  expect(Math.max(...closed.intensity)).toBeGreaterThan(0);
});

it("propagates Greenwood through roots while a bare strip stops it", () => {
  const closed = environment("greenwood"),
    open = environment("greenwood");
  for (const f of [closed, open]) {
    f.g.channels.treeCover.fill(0.8);
    const middle = Math.floor(f.g.height / 2) * f.g.width,
      source = channel(f.state, "magic:greenwood:source", "relative-intensity");
    source.set(middle + 3, 900);
    if (f === closed)
      for (let y = 0; y < f.g.height; y++)
        f.g.channels.treeCover.set(y * f.g.width + Math.floor(f.g.width / 2), 0);
    developRegionalGreenwood(f.state, f.system, f.intensity);
  }
  const right = Math.floor(closed.g.height / 2) * closed.g.width + closed.g.width - 3;
  expect(closed.intensity.get(right)).toBe(0);
  expect(open.intensity.get(right)).toBeGreaterThan(0);
  expect(
    closed.intensity.get(Math.floor(closed.g.height / 2) * closed.g.width + 4)
  ).toBeGreaterThan(0);
});

it("resolves Greenwood spring lines from buried material, recharge and soft rock", () => {
  const soft = environment("greenwood"),
    hard = environment("greenwood");
  for (const f of [soft, hard]) {
    const stock = channel(f.state, "magic:greenwood:stock:stand/stratum", "intensity-square-metre");
    for (let i = 0; i < stock.length; i++) stock.set(i, f.g.measures.get(i) * 1000);
    f.g.channels.rock.fill(f === soft ? 0.1 : 1);
    developRegionalGreenwood(f.state, f.system, f.intensity);
  }
  expect(Math.max(...soft.g.channels["magic:greenwood:origin:spring:source"])).toBeGreaterThan(0);
  expect(
    Array.from(hard.g.channels["magic:greenwood:origin:spring:source"]).every((v) => v === 0)
  ).toBe(true);
});

it("leaches buried Greenwood into groundwater and carries it to a downstream soft-rock break", () => {
  const f = environment("greenwood", 1),
    i = f.g.width * 2 + 3,
    j = i + 1,
    receiver = f.g.coverage.scratch("int32", "supplied:aquifer-path", f.g.active.length).fill(-1),
    order = f.g.coverage.scratch("int32", "supplied:aquifer-order", f.g.active.length),
    stratum = channel(f.state, "magic:greenwood:stock:stand/stratum", "intensity-square-metre");
  f.g.channels.rock.fill(1);
  f.g.channels.rock.set(j, 0.1);
  stratum.set(i, 10 * f.g.measures.get(i));
  const before = stratum.get(i);
  receiver.set(i, j);
  order.set(0, j);
  order.set(1, i);
  f.state.drainage = { receiver, order, count: 2 };
  developRegionalGreenwood(f.state, f.system, f.intensity);
  const aquifer = f.g.channels["magic:greenwood:stock:spring/aquifer"];
  expect(stratum.get(i)).toBeLessThan(before);
  expect(aquifer.get(j)).toBeGreaterThan(0);
  expect(aquifer.get(i)).toBe(0);
  expect(aquifer.get(j) + stratum.get(i)).toBeCloseTo(before, 6);
});

it("keeps fallen Fire release local rather than turning it into a geothermal conduit", () => {
  const f = environment("fire"),
    held = channel(f.state, "magic:fire:stock:fallen/held", "intensity-square-metre");
  for (let i = 0; i < held.length; i++) held.set(i, 1500 * f.g.measures.get(i));
  f.g.channels.fracture.fill(1);
  refineMagic(f.state);
  expect(Math.max(...f.intensity)).toBeGreaterThan(0);
  expect(Array.from(held).some((v) => v === 0)).toBe(true);
  for (let i = 0; i < held.length; i++) if (held.get(i) === 0) expect(f.intensity.get(i)).toBe(0);
});

it("carries Salt dust downwind and leaves settled material at its original bed", () => {
  const f = environment("salt"),
    cell = Math.floor(f.g.height / 2) * f.g.width + Math.floor(f.g.width / 2),
    dust = channel(f.state, "magic:salt:stock:death/dust", "intensity-square-metre");
  dust.set(cell, 1000);
  channel(f.state, "windEast", "ratio", 1);
  developRegionalSalt(f.state, f.system, f.intensity);
  expect(dust.get(cell + 1)).toBeGreaterThan(0);
  expect(dust.get(cell - 1)).toBe(0);
  expect(f.g.channels["magic:salt:stock:death/bed"].get(cell)).toBeGreaterThan(0);
});

it("routes Salt brine into a basin and pools it before a Hallowed boundary", () => {
  const open = environment("salt", 1),
    warded = environment("salt", 1);
  for (const f of [open, warded]) {
    const i = f.g.width * 2 + 3,
      j = i + 1,
      receiver = f.g.coverage.scratch("int32", "supplied:receivers", f.g.active.length).fill(-1),
      order = f.g.coverage.scratch("int32", "supplied:order", f.g.active.length),
      brine = channel(f.state, "magic:salt:stock:death/brine", "intensity-square-metre");
    receiver.set(i, j);
    order.set(0, j);
    order.set(1, i);
    f.state.drainage = { receiver, order, count: 2 };
    brine.set(i, f.g.measures.get(i) * 10);
    if (f === warded)
      channel(f.state, "magic:hallowed:intensity", "relative-intensity").set(j, 800);
    developRegionalSalt(f.state, f.system, f.intensity);
  }
  const i = open.g.width * 2 + 3;
  expect(open.g.channels["magic:salt:stock:death/brine"].get(i + 1)).toBeGreaterThan(0);
  expect(warded.g.channels["magic:salt:stock:death/brine"].get(i + 1)).toBe(0);
  expect(warded.g.channels["magic:salt:stock:death/bed"].get(i)).toBeGreaterThan(0);
});

it("develops sanctuary geography from captured coverage without inventing tenure", () => {
  const f = environment("hallowed"),
    history = structuredClone(f.state.domain.world.epochs);
  channel(f.state, "magic:hallowed:coverage", "ratio", 0.08);
  developRegionalHallowed(f.state, f.system, f.intensity);
  const source = f.g.channels["magic:hallowed:source"],
    peak = Math.max(...source);
  expect(peak).toBeGreaterThan(300);
  expect(Array.from(f.intensity).some((v, i) => source.get(i) === 0 && v > 0 && v < peak)).toBe(
    true
  );
  expect(f.g.channels.tenure).toBeUndefined();
  expect(f.state.domain.world.epochs).toEqual(history);
});

it("moves charge from a sanctuary interior to its rim instead of losing it inside", () => {
  const f = environment("fire", 1);
  f.state.domain.world.magicSystems!.find((s) => s.id === "hallowed")!.enabled = true;
  const ward = channel(f.state, "magic:hallowed:intensity", "relative-intensity");
  for (let i = 0; i < ward.length; i++) ward.set(i, gridPosition(f.g, i).x < 20000 ? 800 : 0);
  f.intensity.set(Math.floor(f.g.height / 2) * f.g.width + 3, 900);
  refineMagic(f.state);
  expect(Array.from(f.intensity).some((v, i) => ward.get(i) === 0 && v > 0)).toBe(true);
  expect(f.intensity.get(f.g.width - 1)).toBe(0);
});

it("pairs coherent stable Veil tears as local door points and a network connection", () => {
  const f = environment("veil");
  f.system.parameters.doorDistance = 10000;
  for (let i = 0; i < f.intensity.length; i++) {
    const p = gridPosition(f.g, i);
    if ((p.x < 8000 || p.x > 30000) && p.y < 5000) f.intensity.set(i, 900);
  }
  developRegionalVeil(f.state, f.system, f.intensity);
  const doors = Object.values(f.state.domain.world.features).filter((f) => f.kind === "veil:door"),
    links = Object.values(f.state.domain.world.networkReaches ?? {});
  expect(doors).toHaveLength(2);
  expect(doors[0].attributes.pairedDoor).toBe(doors[1].id);
  expect(doors[1].attributes.pairedDoor).toBe(doors[0].id);
  expect(links).toHaveLength(1);
  expect(links[0].geometry.type).toBe("LineString");
});

it("feeds newly resolved Fire into ice and rock while leaving unrelated soil intact", () => {
  const f = environment("fire");
  channel(f.state, "magic:fire:coverage", "ratio", 0.08);
  channel(f.state, "geothermal", "ratio", 0.8);
  f.g.channels.fracture.fill(0.8);
  f.g.channels.ice.fill(1);
  const soil = Array.from(f.g.channels.soilDepth),
    rock = Array.from(f.g.channels.rock);
  refineMagic(f.state);
  expect(Array.from(f.g.channels.ice).some((v) => v < 1)).toBe(true);
  expect(Array.from(f.g.channels.rock).some((v, i) => v > rock[i])).toBe(true);
  expect(Array.from(f.g.channels.soilDepth)).toEqual(soil);
});

it("turns concentrated Salt beds into hardened flats and local dissolution hollows", () => {
  const f = environment("salt"),
    bed = channel(f.state, "magic:salt:stock:dead-lake/bed", "intensity-square-metre");
  for (let i = 0; i < bed.length; i++) bed.set(i, f.g.measures.get(i) * 3000);
  refineMagic(f.state);
  expect(Math.max(...f.g.channels.rock)).toBeGreaterThan(1);
  expect(Math.min(...f.g.channels.elevation)).toBeLessThan(100);
});

it("does not activate captured material or stale coverage when its system is disabled", () => {
  const f = environment("fire");
  f.system.enabled = false;
  f.intensity.fill(900);
  channel(f.state, "magic:fire:source", "relative-intensity", 900);
  channel(f.state, "magic:fire:coverage:vein", "ratio", 0.8);
  const temperature = Array.from(f.g.channels.temperature);
  refineMagic(f.state);
  classifyRegionalMagic(f.state);
  expect(Array.from(f.intensity).every((v) => v === 0)).toBe(true);
  expect(Array.from(f.g.channels["magic:fire:coverage:vein"]).every((v) => v === 0)).toBe(true);
  expect(Array.from(f.g.channels.temperature)).toEqual(temperature);
});

it("keeps a captured core outside this map from aliasing onto an interior grid row", () => {
  const f = environment("fire"),
    [, , east] = f.g.bounds;
  putRefinementFeature(
    f.state,
    "outside-core",
    "fire:core",
    "magic",
    { type: "Point", coordinates: [east + 1000, 10000] },
    { intensity: 900 }
  );
  refineMagic(f.state);
  expect(Array.from(f.g.channels["magic:fire:source"]).every((v) => v === 0)).toBe(true);
});
