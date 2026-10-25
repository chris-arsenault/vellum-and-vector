import { expect, it } from "vitest";
import { canonryMagicPresets, magicSystemSchema } from "@atlas/domain";
import { classifyMagicFeatures } from "./magicFeatures";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { advectMagic, initializeMagic, magicBudget } from "./magicState";
import { weightScale } from "./transportPlan";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";

/**
 * The three presets on the magic test scenario, reduced to totals. The origin and stock
 * schema must leave every one of these unchanged: a system with one origin is the system
 * it was before origins existed.
 */
function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        {
          maximumSize: 25_000,
          minimumSize: 6250,
          refine: ([x, , right]) => x < 25_000 && right > -25_000,
        },
        0
      )
    );
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.RockResistance.fill(1000);
  map.FractureConductance.fill(800);
  map.HeatSourceDensity[0] = 1000;
  for (let i = 0; i < map.mesh.count; i++) {
    map.Temperature[i] = Math.round(300 + map.mesh.x[i] * 0.0005);
    map.Elevation[i] = Math.round(map.mesh.x[i] * 0.01 * 1024);
    map.WaterKindCodes[i] = map.mesh.x[i] < 0 ? 1 : 0;
    map.WaterDepths[i] = Math.max(0, -map.Elevation[i]);
    map.IceThickness[i] = map.Temperature[i] < 300 ? 400 : 0;
  }
  initializeMagic(state);
  return state;
}
const total = (values: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return Math.round(sum);
};

it("keeps every preset's located sources and propagated field exactly as before origins", () => {
  const state = scenario();
  const totals = state.physical!.magic!.fields.map((field) => {
    locateMagicSources(state, field, 42);
    propagateMagic(state, field, 42, 1);
    return {
      id: field.definition.id,
      source: total(field.source),
      intensity: total(field.intensity),
      wake: total(field.wake),
      retained: total(field.retained),
      active: field.intensity.filter((value) => value > 0).length,
    };
  });
  expect(totals).toMatchInlineSnapshot(`
    [
      {
        "active": 7,
        "id": "fire",
        "intensity": 2290,
        "retained": 0,
        "source": 1000,
        "wake": 0,
      },
      {
        "active": 352,
        "id": "aurora",
        "intensity": 211480,
        "retained": 3107859568873,
        "source": 25120,
        "wake": 0,
      },
      {
        "active": 176,
        "id": "pressure",
        "intensity": 175192,
        "retained": 0,
        "source": 1000,
        "wake": 27,
      },
      {
        "active": 0,
        "id": "greenwood",
        "intensity": 0,
        "retained": 0,
        "source": 0,
        "wake": 0,
      },
      {
        "active": 0,
        "id": "salt",
        "intensity": 0,
        "retained": 0,
        "source": 0,
        "wake": 0,
      },
      {
        "active": 0,
        "id": "hallowed",
        "intensity": 0,
        "retained": 0,
        "source": 0,
        "wake": 0,
      },
    ]
  `);
});

it("mirrors each origin's source into its first reservoir and closes the budget", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields[0];
  locateMagicSources(state, fire, 42);
  propagateMagic(state, fire, 42, 1);
  const held = fire.stocks["vein/held"];
  expect(held).toBeDefined();
  for (let i = 0; i < held.length; i++)
    expect(held[i]).toBeCloseTo(fire.source[i] * map.mesh.areas[i], 6);
  const budget = magicBudget(fire, map);
  expect(budget.created).toBeGreaterThan(0);
  expect(budget.carried).toBeCloseTo(budget.created, 3);
  expect(budget.released).toBeGreaterThan(budget.created);
});

it("carries a crust stock by the transport plan's weights and conserves its total", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields[0],
    count = map.mesh.count;
  const held = fire.stocks["vein/held"];
  held.fill(0);
  held[0] = 1000;
  held[1] = 500;
  // A synthetic plan: cell 0 splits three ways, cell 1 lands whole on cell 2, others stay.
  const offsets = new Int32Array(count + 1),
    targets: number[] = [],
    weights: number[] = [];
  for (let i = 0; i < count; i++) {
    offsets[i] = targets.length;
    if (i === 0) {
      targets.push(3, 4, 5);
      weights.push(weightScale / 2, weightScale / 4, weightScale / 4);
    } else if (i === 1) {
      targets.push(2);
      weights.push(weightScale);
    } else {
      targets.push(i);
      weights.push(weightScale);
    }
  }
  offsets[count] = targets.length;
  map.transportPlan = {
    offsets,
    targets: Int32Array.from(targets),
    weights: Float64Array.from(weights),
    arrivals: new Float64Array(count),
    dominant: new Int32Array(count).fill(-1),
    dominantWeight: new Float64Array(count),
  };
  map.AdvectionSourceIndex.fill(-1);
  for (let i = 0; i < count; i++) map.AdvectionSourceIndex[i] = i;
  advectMagic(state);
  expect(Array.from(held.slice(0, 6))).toEqual([0, 0, 500, 500, 250, 250]);
  expect(held.reduce((sum, value) => sum + value, 0)).toBe(1500);
  // Without a plan the amount stays where it is.
  map.transportPlan = null;
  advectMagic(state);
  expect(held.reduce((sum, value) => sum + value, 0)).toBe(1500);
});

it("locates and propagates two origins on their own rules and keeps the stronger in the field", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields[0];
  map.HeatSourceDensity.fill(600);
  map.HeatSourceDensity[0] = 1000;
  fire.definition = magicSystemSchema.parse({
    ...fire.definition,
    origins: [
      ...fire.definition.origins,
      {
        id: "scatter",
        source: "geothermal",
        propagation: "radial",
        renewal: "finite",
        parameters: { sourceThreshold: 500, maximumSources: 4, sourceSpacing: 30_000 },
      },
    ],
    features: [
      {
        id: "vein-core",
        name: "Vein core",
        priority: 5,
        seeds: [[{ field: "source:vein", min: 1 }]],
      },
    ],
  });
  initializeMagic(state, true, [fire.definition, ...canonryMagicPresets().slice(1)]);
  const field = state.physical!.magic!.fields[0];
  locateMagicSources(state, field, 42);
  propagateMagic(state, field, 42, 1);
  const vein = field.originSources.vein,
    scatter = field.originSources.scatter;
  expect(field.located.some((point) => point.origin === "vein")).toBe(true);
  expect(field.located.some((point) => point.origin === "scatter")).toBe(true);
  expect(scatter.some((value) => value > 0)).toBe(true);
  expect(vein.some((value) => value > 0)).toBe(true);
  for (let i = 0; i < field.source.length; i++)
    expect(field.source[i]).toBe(Math.max(vein[i], scatter[i]));
  // The radial origin reaches cells the fracture origin never did, and the fracture origin's
  // own cells keep at least their own intensity.
  expect(field.intensity.filter((value) => value > 0).length).toBeGreaterThan(7);
  classifyMagicFeatures(state, 42);
  const cores = field.features["vein-core"];
  expect(Array.from(cores).filter(Boolean).length).toBe(vein.filter((value) => value > 0).length);
});
