import {
  everySample,
  foldSamples,
  gridPosition,
  putChannel,
  semanticId,
  requireThat,
  type Band,
  type Grid,
} from "@atlas/domain";
import { requireChannel } from "./mapFields";
import {
  adjacency,
  checkProgress,
  cellDistance,
  epochYears,
  mixHash,
  movableTerrain,
  smoothNoise,
} from "./mapLattice";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";

const invalidates = [
  "temperature",
  "precipitation",
  "rainfall",
  "snowfall",
  "moisture",
  "runoff",
  "drainage",
  "flow",
  "lakes",
];
interface Province {
  x: number;
  y: number;
  dx: number;
  dy: number;
  continental: number;
}

// Earlier rectangular-grid prototype, retained by process-composition tests.
// Active atlas generation uses the source port in canonry/.
export const initializeTerrainProcess: MapProcess = {
  contract: {
    id: "physical.initialize",
    version: "1",
    requires: [],
    produces: ["elevation", "geology", "fracture"],
    invalidates,
    parameters: {
      provinces: { type: "integer", unit: "count", required: false, default: 7, minimum: 2 },
      relief: { type: "number", unit: "metre", required: false, default: 1800, minimum: 0 },
      seaLevel: { type: "number", unit: "metre", required: false, default: 0 },
      plateSpeed: {
        type: "number",
        unit: "metre/year",
        required: false,
        default: 0.025,
        minimum: 0,
      },
    },
  },
  behavior: {
    kind: "initialize",
    initialize(state, context) {
      const grid = state.surface,
        seed = Math.floor(context.random(true) * 4294967296);
      const plates = provinces(grid, context),
        fields = initialFields(grid);
      const scale = Math.max(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]);
      for (let i = 0; i < grid.active.length; i++) {
        checkProgress(context, i, grid.active.length, "Assembling persistent crustal provinces");
        if (!grid.active.get(i)) continue;
        initializeCell(grid, i, plates, fields, seed, scale, context);
      }
      for (const [name, values] of Object.entries(fields))
        if (!grid.channels[name]) putChannel(grid, name, channelUnit(name), values);
      const ids = plates.map((_plate, i) =>
        semanticId(context.scope.worldId, "geological-province", String(i + 1))
      );
      for (const [i, id] of ids.entries()) {
        if (state.domain.world.entities[id]) continue;
        state.domain.world.entities[id] = {
          id,
          name: `Crustal province ${i + 1}`,
          kind: "geologicalProvince",
          state: "generated",
          attributes: { province: i + 1, center: { x: plates[i].x, y: plates[i].y, z: 0 } },
          relations: [],
        };
      }
      context.recordCause({
        kind: "domain",
        process: "physical.initialize",
        subjects: ids,
        description:
          "Crustal province buoyancy, convergent margins and nested spatial relief initialized the material surface.",
      });
    },
  },
  validate(state) {
    return validateTerrain(state);
  },
};

function provinces(grid: Grid, context: MapProcessContext): Province[] {
  const count = Number(context.parameters.provinces),
    speed = Number(context.parameters.plateSpeed);
  const cells = grid.coverage.scratch(
    "int32",
    "terrain:active-cells",
    foldSamples(grid.active, (sum, v) => sum + (v ? 1 : 0), 0)
  );
  for (let i = 0, n = 0; i < grid.active.length; i++) if (grid.active.get(i)) cells.set(n++, i);
  requireThat(cells.length > 0, "physical_extent", "Terrain needs active mapped cells.");
  const chosen: Province[] = [];
  for (let n = 0; n < count; n++) {
    const candidates = Array.from({ length: 12 }, () =>
      gridPosition(grid, cells.get(Math.floor(context.random(true) * cells.length)))
    );
    const selected = candidates.sort((a, b) => separation(b, chosen) - separation(a, chosen))[0];
    const angle = context.random(true) * Math.PI * 2;
    chosen.push({
      x: selected.x,
      y: selected.y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      continental: context.random(true),
    });
  }
  grid.coverage.release(cells);
  return chosen;
}
function separation(p: { x: number; y: number }, previous: Province[]) {
  return previous.reduce(
    (minimum, v) => Math.min(minimum, Math.hypot(v.x - p.x, v.y - p.y)),
    Infinity
  );
}
function initialFields(grid: Grid): Record<string, Band> {
  return Object.fromEntries(
    [
      "elevation",
      "bedrock",
      "sediment",
      "rock",
      "fracture",
      "province",
      "crustMotionX",
      "crustMotionY",
      "uplift",
      "carbonate",
    ].map((key) => [key, grid.coverage.scratch("float64", `terrain:${key}`, grid.active.length)])
  );
}
function channelUnit(name: string) {
  if (["elevation", "bedrock", "sediment"].includes(name)) return "metre";
  if (["crustMotionX", "crustMotionY", "uplift"].includes(name)) return "metre/year";
  return name === "province" ? "category" : "ratio";
}
function initializeCell(
  grid: Grid,
  i: number,
  plates: Province[],
  fields: Record<string, Band>,
  seed: number,
  scale: number,
  context: MapProcessContext
) {
  const p = gridPosition(grid, i),
    sorted = plates
      .map((plate, n) => ({ plate, n, distance: Math.hypot(p.x - plate.x, p.y - plate.y) }))
      .sort((a, b) => a.distance - b.distance);
  const first = sorted[0],
    second = sorted[1],
    relief = Number(context.parameters.relief);
  const x = (p.x - grid.bounds[0]) / scale,
    y = (p.y - grid.bounds[1]) / scale;
  const broad = smoothNoise(x * 3, y * 3, seed),
    hills = smoothNoise(x * 12, y * 12, seed ^ 1171);
  const fine = smoothNoise(x * 37, y * 37, seed ^ 9631);
  const margin = Math.exp(-(second.distance - first.distance) / Math.max(1, scale * 0.045));
  const continental = first.plate.continental * 0.55 + (broad + 1) * 0.225;
  const dx = second.plate.x - first.plate.x,
    dy = second.plate.y - first.plate.y;
  const convergence =
    ((first.plate.dx - second.plate.dx) * dx + (first.plate.dy - second.plate.dy) * dy) /
    Math.max(1, Math.hypot(dx, dy));
  const ridge =
    (Math.max(0, convergence) / Math.max(0.001, Number(context.parameters.plateSpeed))) * margin;
  fields.elevation.set(
    i,
    Number(context.parameters.seaLevel) +
      relief * ((continental - 0.48) * 3 + hills * 0.22 + fine * 0.06 + ridge * 0.8)
  );
  fields.bedrock.set(
    i,
    grid.channels.bedrock?.get(i) ??
      (grid.channels.elevation?.get(i) ?? fields.elevation.get(i)) -
        (grid.channels.sediment?.get(i) ?? 0)
  );
  fields.province.set(i, first.n + 1);
  fields.crustMotionX.set(i, first.plate.dx);
  fields.crustMotionY.set(i, first.plate.dy);
  fields.fracture.set(i, Math.min(1, 0.08 + margin * 0.75));
  fields.uplift.set(i, convergence * 0.1 * margin);
  fields.rock.set(i, 0.25 + 0.65 * mixHash(first.n, 73, seed));
  fields.carbonate.set(
    i,
    Math.max(0, 0.5 - Math.abs(continental - 0.5)) * (1 - fields.rock.get(i))
  );
}

export const tectonicsProcess: MapProcess = {
  contract: {
    id: "physical.tectonics",
    version: "1",
    parameters: {
      activity: { type: "number", unit: "ratio", required: false, default: 1, minimum: 0 },
      upliftRate: {
        type: "number",
        unit: "metre/year",
        required: false,
        default: 0.002,
        minimum: 0,
      },
      advection: { type: "boolean", unit: null, required: false, default: true },
    },
    requires: ["elevation", "geology"],
    produces: ["elevation", "geology", "fracture"],
    invalidates,
  },
  behavior: {
    kind: "model-pass",
    applyPass(state, context) {
      const grid = state.surface,
        elevation = requireChannel(grid, "elevation", "metre");
      const bedrock = requireChannel(grid, "bedrock", "metre"),
        sediment = requireChannel(grid, "sediment", "metre");
      const motionX = requireChannel(grid, "crustMotionX", "metre/year"),
        motionY = requireChannel(grid, "crustMotionY", "metre/year");
      const mobile = movableTerrain(state),
        links = adjacency(grid, false),
        years = epochYears(context);
      const activity = Number(context.parameters.activity),
        rate = Number(context.parameters.upliftRate);
      const uplift = grid.coverage.scratch("float64", "terrain:uplift", elevation.length),
        fracture = requireChannel(grid, "fracture", "ratio");
      if (context.parameters.advection) advect(state, mobile, years * activity, motionX, motionY);
      for (let i = 0; i < elevation.length; i++) {
        checkProgress(context, i, elevation.length, "Evolving crust motion and accumulated uplift");
        if (!mobile.get(i)) continue;
        const closure =
          links(i).reduce((sum, j) => {
            const a = gridPosition(grid, i),
              b = gridPosition(grid, j),
              length = cellDistance(grid, i, j);
            return (
              sum +
              ((motionX.get(i) - motionX.get(j)) * (b.x - a.x) +
                (motionY.get(i) - motionY.get(j)) * (b.y - a.y)) /
                Math.max(1, length)
            );
          }, 0) / Math.max(1, links(i).length);
        uplift.set(i, rate * Math.tanh(closure / 0.01) * activity);
        bedrock.add(i, uplift.get(i) * years);
        elevation.set(i, bedrock.get(i) + sediment.get(i));
        fracture.set(i, Math.min(1, fracture.get(i) + Math.abs(closure) * years * 0.0001));
      }
      putChannel(grid, "uplift", "metre/year", uplift);
      context.recordCause({
        kind: "domain",
        process: "physical.tectonics",
        subjects: [grid.id],
        description: `Persistent crust advected and accumulated material uplift over ${years} years; existing sediment and masked authoring were retained.`,
      });
    },
  },
  validate(state) {
    return validateTerrain(state);
  },
};

function advect(state: GenerationState, movable: Band, years: number, dx: Band, dy: Band) {
  const grid = state.surface,
    channels = [
      "bedrock",
      "rock",
      "fracture",
      "province",
      "carbonate",
      "crustMotionX",
      "crustMotionY",
    ];
  const source = Object.fromEntries(
    channels.map((key) => [key, grid.coverage.copyBand(grid.channels[key])])
  );
  requireThat(
    !grid.topology,
    "prototype_grid",
    "Use the Canonry workflow for adaptive physical geography."
  );
  const stepX = (grid.bounds[2] - grid.bounds[0]) / (grid.width - 1),
    stepY = (grid.bounds[3] - grid.bounds[1]) / (grid.height - 1);
  // The movable upstream cell material arrives from, or -1.
  const origin = (i: number) => {
    const x = Math.round((i % grid.width) - (dx.get(i) * years) / stepX),
      y = Math.round(Math.floor(i / grid.width) - (dy.get(i) * years) / stepY);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -1;
    const from = y * grid.width + x;
    return grid.active.get(from) && movable.get(from) ? from : -1;
  };
  for (let i = 0; i < movable.length; i++) {
    const from = movable.get(i) ? origin(i) : -1;
    if (from >= 0) for (const key of channels) grid.channels[key].set(i, source[key].get(from));
  }
  for (const band of Object.values(source)) grid.coverage.release(band);
}
function validateTerrain(state: GenerationState) {
  for (const name of ["elevation", "bedrock", "sediment"])
    requireChannel(state.surface, name, "metre");
  for (const name of ["rock", "fracture", "carbonate"])
    requireChannel(state.surface, name, "ratio");
  requireThat(
    everySample(state.surface.channels.sediment, (v) => v >= 0),
    "negative_sediment",
    "Sediment thickness cannot be negative."
  );
  return [];
}
