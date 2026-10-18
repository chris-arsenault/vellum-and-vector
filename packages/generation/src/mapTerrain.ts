import { gridPosition, putChannel, semanticId, requireThat, type Grid } from "@atlas/domain";
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
  apply(state, context) {
    const grid = state.surface,
      seed = Math.floor(context.random(true) * 4294967296);
    const plates = provinces(grid, context),
      fields = initialFields(grid);
    const scale = Math.max(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]);
    for (let i = 0; i < grid.active.length; i++) {
      checkProgress(context, i, grid.active.length, "Assembling persistent crustal provinces");
      if (!grid.active[i]) continue;
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
  validate(state) {
    return validateTerrain(state);
  },
};

function provinces(grid: Grid, context: MapProcessContext): Province[] {
  const count = Number(context.parameters.provinces),
    speed = Number(context.parameters.plateSpeed);
  const cells = Array.from(grid.active.keys()).filter((i) => grid.active[i]);
  requireThat(cells.length > 0, "physical_extent", "Terrain needs active mapped cells.");
  const chosen: Province[] = [];
  for (let n = 0; n < count; n++) {
    const candidates = Array.from({ length: 12 }, () =>
      gridPosition(grid, cells[Math.floor(context.random(true) * cells.length)])
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
  return chosen;
}
function separation(p: { x: number; y: number }, previous: Province[]) {
  return previous.reduce(
    (minimum, v) => Math.min(minimum, Math.hypot(v.x - p.x, v.y - p.y)),
    Infinity
  );
}
function initialFields(grid: Grid): Record<string, Float64Array> {
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
    ].map((key) => [key, new Float64Array(grid.active.length)])
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
  fields: Record<string, Float64Array>,
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
  fields.elevation[i] =
    Number(context.parameters.seaLevel) +
    relief * ((continental - 0.48) * 3 + hills * 0.22 + fine * 0.06 + ridge * 0.8);
  fields.bedrock[i] =
    grid.channels.bedrock?.[i] ??
    (grid.channels.elevation?.[i] ?? fields.elevation[i]) - (grid.channels.sediment?.[i] ?? 0);
  fields.province[i] = first.n + 1;
  fields.crustMotionX[i] = first.plate.dx;
  fields.crustMotionY[i] = first.plate.dy;
  fields.fracture[i] = Math.min(1, 0.08 + margin * 0.75);
  fields.uplift[i] = convergence * 0.1 * margin;
  fields.rock[i] = 0.25 + 0.65 * mixHash(first.n, 73, seed);
  fields.carbonate[i] = Math.max(0, 0.5 - Math.abs(continental - 0.5)) * (1 - fields.rock[i]);
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
  apply(state, context) {
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
    const uplift = new Float64Array(elevation.length),
      fracture = requireChannel(grid, "fracture", "ratio");
    if (context.parameters.advection) advect(state, mobile, years * activity, motionX, motionY);
    for (let i = 0; i < elevation.length; i++) {
      checkProgress(context, i, elevation.length, "Evolving crust motion and accumulated uplift");
      if (!mobile[i]) continue;
      const closure =
        links[i].reduce((sum, j) => {
          const a = gridPosition(grid, i),
            b = gridPosition(grid, j),
            length = cellDistance(grid, i, j);
          return (
            sum +
            ((motionX[i] - motionX[j]) * (b.x - a.x) + (motionY[i] - motionY[j]) * (b.y - a.y)) /
              Math.max(1, length)
          );
        }, 0) / Math.max(1, links[i].length);
      uplift[i] = rate * Math.tanh(closure / 0.01) * activity;
      bedrock[i] += uplift[i] * years;
      elevation[i] = bedrock[i] + sediment[i];
      fracture[i] = Math.min(1, fracture[i] + Math.abs(closure) * years * 0.0001);
    }
    putChannel(grid, "uplift", "metre/year", uplift);
    context.recordCause({
      kind: "domain",
      process: "physical.tectonics",
      subjects: [grid.id],
      description: `Persistent crust advected and accumulated material uplift over ${years} years; existing sediment and masked authoring were retained.`,
    });
  },
  validate(state) {
    return validateTerrain(state);
  },
};

function advect(
  state: GenerationState,
  movable: Uint8Array,
  years: number,
  dx: Float64Array,
  dy: Float64Array
) {
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
  const source = Object.fromEntries(channels.map((key) => [key, grid.channels[key].slice()]));
  const stepX = (grid.bounds[2] - grid.bounds[0]) / (grid.width - 1),
    stepY = (grid.bounds[3] - grid.bounds[1]) / (grid.height - 1);
  for (let i = 0; i < movable.length; i++) {
    if (!movable[i]) continue;
    const x = Math.round((i % grid.width) - (dx[i] * years) / stepX),
      y = Math.round(Math.floor(i / grid.width) - (dy[i] * years) / stepY);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
    const from = y * grid.width + x;
    if (!grid.active[from] || !movable[from]) continue;
    for (const key of channels) grid.channels[key][i] = source[key][from];
  }
}
function validateTerrain(state: GenerationState) {
  for (const name of ["elevation", "bedrock", "sediment"])
    requireChannel(state.surface, name, "metre");
  for (const name of ["rock", "fracture", "carbonate"])
    requireChannel(state.surface, name, "ratio");
  requireThat(
    state.surface.channels.sediment.every((v) => v >= 0),
    "negative_sediment",
    "Sediment thickness cannot be negative."
  );
  return [];
}
