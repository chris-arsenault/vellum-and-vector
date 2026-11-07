import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Follower, program, sorted, source, sourceFiles, stepCalls } from "./architectureReach";
import { answerKeys, respondersTo, type AnswerKey } from "./coupling/answers";
import "./coupling/responders";
import { historyEvents, historyRules, quantityKinds } from "./coupling/quantities";
import { Stage } from "./coupling/stage";
import { groundProcesses } from "./processes/processCatalogue";
import { groundOf } from "./rock/ground";
import { rockCatalogue } from "./rock/rockCatalogue";
import { setLayer } from "./rock/rockColumn";
import { createField, type PhysicalField } from "./world/field";
import { units } from "./world/math";
import { allSteps, physicalSteps } from "./world/physicalSteps";
import { physicalSchedule } from "./world/schedule";
import { rebuild } from "./world/surface";
import { createWorldMesh } from "./world/worldMesh";
import { compileMix } from "./rock/modes";

/**
 * The process coupling design (ADR 0011), held as checks that fail until the code is what the design
 * says. Each `it` names the part of the design it binds.
 */
const text = (path: string) => readFileSync(join(source, path), "utf8");
const files = () => [...sourceFiles(source)].map((path) => relative(source, path));
const magicSystems = ["fire", "aurora", "pressure", "greenwood", "salt", "veil"];

function smallField(): PhysicalField {
  const map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 2000, 25_000));
  map.EffectiveSeaLevel = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    setLayer(map, i, 0, rockCatalogue.schist.code, units(2_000));
    map.CrustContinentalFraction.set(i, 1000);
    map.CrustThickness.set(i, units(35_000));
    map.CrustContinentalColumn.set(i, units(35_000));
    map.BedrockElevation.set(i, units(1_000));
    rebuild(map, i);
  }
  return map;
}

describe("4.2 processes read the world by asking keys", () => {
  const designKeys: AnswerKey[] = [
    "discharge",
    "loadCapacity",
    "waveEnergy",
    "looseSupply",
    "rootHold",
    "heat",
    "wetness",
    "frost",
  ] as AnswerKey[];
  it("names the design's questions as keys", () => {
    expect(designKeys.filter((key) => !(answerKeys as readonly string[]).includes(key))).toEqual(
      []
    );
  });
  it("gives every key a base answer and someone who asks it", () => {
    const asked = new Set(groundProcesses.flatMap((each) => each.asks));
    const gaps = answerKeys.flatMap((key) => [
      ...(respondersTo(key).some((one) => "base" in one) ? [] : [`${key} has no base answer`]),
      ...(asked.has(key) ? [] : [`nobody asks ${key}`]),
    ]);
    expect(gaps).toEqual([]);
  });
  it("answers rain into rivers: streams and their load ask discharge, and runoff answers it", () => {
    const asks = (id: string) => groundProcesses.find((each) => each.id === id)!.asks;
    expect(asks("streams")).toContain("discharge");
    expect(asks("river-load")).toEqual(
      expect.arrayContaining(["discharge", "looseSupply", "loadCapacity"])
    );
    expect(respondersTo("discharge").flatMap((one) => one.reads)).toContain("Runoff");
  });
  it("has each key's base answer written before the first step that asks it", () => {
    // A band no land step writes comes from another domain's previous pass, such as plant cover.
    const schedule = physicalSchedule([{} as never]),
      landWritten = new Set(schedule.flatMap(({ step }) => physicalSteps[step[0]].writes)),
      written = new Set<string>(),
      late: string[] = [],
      baseReads = (key: AnswerKey) => respondersTo(key).find((one) => "base" in one)?.reads ?? [];
    for (const { step } of schedule) {
      for (const key of new Set(step[3].flatMap((process) => process.asks)))
        for (const band of baseReads(key))
          if (landWritten.has(band) && !written.has(band))
            late.push(`${step[0]} asks ${key} before ${band} is written`);
      for (const band of physicalSteps[step[0]].writes) written.add(band);
    }
    expect([...new Set(late)]).toEqual([]);
  });
});

describe("4.2 and 5: magic answers through its own medium, in its own module", () => {
  const registrations = () => {
    const found: { by: string; file: string }[] = [];
    for (const file of files()) {
      const body = text(file);
      for (const match of body.matchAll(/respond\(\{[^}]*?by:\s*"([^"]+)"/gs))
        found.push({ by: match[1], file });
    }
    return found;
  };
  it("registers each magic system's responders from that system's module", () => {
    const misplaced = registrations()
      .filter(({ by }) => magicSystems.includes(by))
      .filter(({ by, file }) => !/magic/i.test(file) || !file.toLowerCase().includes(by))
      .map(({ by, file }) => `${by} in ${file}`);
    expect(misplaced).toEqual([]);
  });
  it("lets Greenwood's springs wet the ground", () => {
    expect(respondersTo("wetness").map((one) => one.by)).toContain("greenwood");
  });
  it("lets Fire soften rock", () => {
    const keys = answerKeys.filter((key) => respondersTo(key).some((one) => one.by === "fire"));
    expect(keys).toEqual(expect.arrayContaining(["heat"]));
  });
  it("writes no temperature, ice, water or ground from magic or ecology", () => {
    const touched =
      /\.(Temperature|IceThickness|Rainfall|Runoff|Elevation|BedrockElevation|SedimentThickness|SurfaceRockLoad|CrustThickness|SoilDepth)\.(set|add|fill)\(/;
    const writers = files()
      .filter((file) => /magic|ecology/i.test(file) && !file.startsWith("regional/"))
      .filter((file) => !/^world\/ecology(State|Soils)\.ts$/.test(file))
      .filter((file) => touched.test(text(file)));
    expect(writers).toEqual([]);
  });
});

describe("4.3 a process acts down through the cell's stack", () => {
  const mix = () => compileMix({ abrasion: 1 });
  it("reaches soil before loose sediment, and both before rock", () => {
    const map = smallField(),
      ground = groundOf(map),
      order: string[] = [],
      i = 0;
    map.SoilDepth.set(i, 1);
    map.SedimentThickness.set(i, units(2));
    rebuild(map, i);
    const note = (layer: string) => (sofar: number) => (order.push(layer), sofar);
    ground.fold(i, {
      start: 0,
      soil: note("soil"),
      loose: note("loose"),
      ice: note("ice"),
      rock: note("rock"),
      crust: note("crust"),
      throughColumn: true,
    });
    expect(order[0]).toBe("soil");
    expect(order.indexOf("loose")).toBeLessThan(order.indexOf("rock"));
    expect(order[order.length - 1]).toBe("crust");
  });
  it("takes soil first when it acts", () => {
    const map = smallField(),
      i = 0;
    map.SoilDepth.set(i, 1);
    const reached = groundOf(map).actOn(i, mix(), 0.05, Infinity);
    expect(reached).toBeGreaterThan(0);
    expect(groundOf(map).taken(i).soil).toBeGreaterThan(0);
    expect(groundOf(map).taken(i).rock).toBe(0);
  });
  it("reaches ice lying on the cell", () => {
    const map = smallField(),
      order: string[] = [];
    map.IceThickness.set(0, 100);
    const note = (layer: string) => (sofar: number) => (order.push(layer), sofar);
    groundOf(map).fold(0, { start: 0, ice: note("ice"), rock: note("rock") });
    expect(order).toEqual(["ice", "rock"]);
  });
  it("wears past the rock column into the crust beneath", () => {
    const map = smallField();
    groundOf(map).actOn(0, mix(), 1e9, Infinity);
    expect(groundOf(map).taken(0).crust).toBeGreaterThan(0);
  });
  it("lets the attack and the material set what goes, with no ceiling of its own", () => {
    expect(text("rock/ground.ts")).not.toMatch(/mostGiven/);
  });
});

describe("4.4 processes demand transfers and one ledger applies them", () => {
  it("shares out what a pool holds when a simultaneous stage asks for more than it holds", () => {
    const map = smallField(),
      i = 0;
    map.SedimentThickness.set(i, units(10));
    rebuild(map, i);
    const stage = new Stage(map, { simultaneous: true });
    stage.demand("loose", "load", i, units(15), "streams");
    stage.demand("loose", "load", i, units(5), "slopes");
    const moved = stage.settle();
    expect(moved.get("streams")! + moved.get("slopes")!).toBeCloseTo(units(10), -2);
    expect(moved.get("streams")! / moved.get("slopes")!).toBeCloseTo(3, 1);
  });
  it("lands a sequential stage's demands in order, the first taking what it asks", () => {
    const map = smallField(),
      i = 0;
    map.SedimentThickness.set(i, units(10));
    rebuild(map, i);
    const stage = new Stage(map, { simultaneous: false });
    stage.demand("loose", "load", i, units(8), "streams");
    stage.demand("loose", "load", i, units(8), "slopes");
    const moved = stage.settle();
    expect(moved.get("streams")).toBeCloseTo(units(8), -2);
    expect(moved.get("slopes")).toBeCloseTo(units(2), -2);
  });
  it("runs rivers and hillslopes in one simultaneous stage, so they compete for loose ground", () => {
    const shared = allSteps.filter(
      (step) =>
        step[4]?.simultaneous &&
        step[3].some(({ id }) => id === "streams") &&
        step[3].some(({ id }) => /slope|creep/i.test(id))
    );
    expect(shared.map((step) => step[0])).not.toEqual([]);
  });
  it("changes the land's height, rock and sediment only through the ledger", () => {
    const land =
      /\.(BedrockElevation|SurfaceRockLoad|SedimentThickness|Elevation|CrustThickness)\.(set|add|fill)\(/;
    const owners = new Set([
      "rock/groundLedger.ts", // The ledger.
      "world/surface.ts", // Rebuilding the surface from what the ledger holds.
      "world/crustTransport.ts", // Plates carrying whole columns, which the history events move.
      "world/atlasWorkspace.ts", // Setting up a world from what was saved or drawn.
      "societyEnvironment.ts", // Reading a saved surface back.
      "world/worldGeographyFixtures.ts", // A flat fixture world for tests, set up whole.
    ]);
    const stray = files().filter((file) => !owners.has(file) && land.test(text(file)));
    expect(stray).toEqual([]);
  });
});

describe("4.5 every quantity answers every history event by its kind", () => {
  it("defines what each kind does on each event", () => {
    const missing = Object.keys(historyRules).flatMap((kind) =>
      historyEvents
        .filter((event) => !(historyRules as Record<string, Record<string, unknown>>)[kind][event])
        .map((event) => `${kind} on ${event}`)
    );
    expect(sorted(Object.keys(historyRules))).toEqual(
      sorted(new Set(Object.values(quantityKinds)))
    );
    expect(missing).toEqual([]);
    expect(sorted(historyEvents)).toEqual(
      sorted(["moved", "overlapped", "newCrust", "sinking", "rifted", "unroofed"])
    );
  });
  it("moves bands with the crust by their kind, naming none by hand", () => {
    const named = [...text("world/transportHistory.ts").matchAll(/"([A-Z][A-Za-z]+)"/g)].map(
      (match) => match[1]
    );
    expect(named.filter((name) => name in quantityKinds)).toEqual([]);
  });
});

describe("4.6 and 4.7 work by span and material, not by passes and caps", () => {
  it("names no limit per pass", () => {
    const perPass = files().filter((file) => /Maximum\w*PerPass/.test(text(file)));
    expect(perPass).toEqual([]);
  });
});

describe("4.9 an epoch reaches processes as data", () => {
  it("lets no process ask whether it is the first epoch", () => {
    const built = program(),
      follower = new Follower(built),
      steps = stepCalls(built.getSourceFile(join(source, "world/sequence.ts"))!),
      reaching = [...steps]
        .filter(([, processes]) => follower.follow(processes).epoch.has("IsEvolutionEpoch"))
        .map(([name]) => name);
    expect(sorted(reaching)).toEqual([]);
  });
});

describe("5 Canonry is research input only", () => {
  it("leaves no Canonry order or contract in the land's sequence and processes", () => {
    const residue = files()
      .filter((file) =>
        /^(world\/(sequence|schedule|physicalSteps)\.ts|processes\/|coupling\/)/.test(file)
      )
      .filter((file) => /canonry/i.test(text(file)));
    expect(residue).toEqual([]);
  });
});
