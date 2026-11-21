import type {
  BrushMode,
  Bounds,
  HeightArea,
  HeightLine,
  HeightPeak,
  Stroke,
  TerrainEdit,
} from "@atlas/map";

/** The tools of the authored-map toolbar. Several map onto one canvas interaction. */
export type AuthoredTool =
  | "select"
  | "points"
  | "landmass"
  | "raise"
  | "lower"
  | "smooth"
  | "flatten"
  | "set"
  | "heightLine"
  | "heightArea"
  | "peak"
  | "river"
  | "street"
  | "building"
  | "plot"
  | "place";
export type ToolGroup = "Land" | "Elevation" | "Water" | "Places" | "Edit" | "Streets & parcels";
export interface ToolInfo {
  id: AuthoredTool;
  label: string;
  group: ToolGroup;
  /** The single key that picks the tool while no field has focus. */
  key: string;
  hint: string;
}
const worldGroups: ToolGroup[] = ["Edit", "Land", "Elevation", "Water", "Places"];
const cityGroups: ToolGroup[] = ["Edit", "Streets & parcels", "Places"];
/** A City map (profile "local") draws streets and parcels; world and region maps draw land,
 * relief and water. Both keep Edit and the catalogue's Places. */
export const isCityProfile = (profile: string) => profile === "local";
export const toolGroupsFor = (profile: string): ToolGroup[] =>
  isCityProfile(profile) ? cityGroups : worldGroups;
export const toolsFor = (profile: string): ToolInfo[] => {
  const groups = toolGroupsFor(profile);
  return authoredTools.filter((tool) => groups.includes(tool.group));
};
export const authoredTools: ToolInfo[] = [
  { id: "select", label: "Select", group: "Edit", key: "V", hint: "Pick a shape, drag to move" },
  { id: "points", label: "Edit points", group: "Edit", key: "P", hint: "Drag a shape's vertices" },
  { id: "landmass", label: "Landmass", group: "Land", key: "L", hint: "Draw a coast" },
  { id: "raise", label: "Raise", group: "Elevation", key: "R", hint: "Brush the land up" },
  { id: "lower", label: "Lower", group: "Elevation", key: "W", hint: "Brush the land down" },
  { id: "smooth", label: "Smooth", group: "Elevation", key: "S", hint: "Soften relief" },
  { id: "flatten", label: "Flatten", group: "Elevation", key: "F", hint: "Level to a height" },
  { id: "set", label: "Set height", group: "Elevation", key: "T", hint: "Paint an exact height" },
  { id: "heightLine", label: "Ridge line", group: "Elevation", key: "H", hint: "Guide line" },
  { id: "heightArea", label: "Height area", group: "Elevation", key: "A", hint: "Plateau area" },
  { id: "peak", label: "Peak", group: "Elevation", key: "K", hint: "Click to raise a summit" },
  { id: "river", label: "River", group: "Water", key: "I", hint: "Draw a river or stream" },
  {
    id: "street",
    label: "Draw street",
    group: "Streets & parcels",
    key: "G",
    hint: "Lay a street",
  },
  {
    id: "building",
    label: "Building",
    group: "Streets & parcels",
    key: "B",
    hint: "Place a building",
  },
  {
    id: "plot",
    label: "Draw plot",
    group: "Streets & parcels",
    key: "O",
    hint: "Outline a parcel",
  },
  { id: "place", label: "Place", group: "Places", key: "N", hint: "Place any catalogue kind" },
];
export const toolByKey = (key: string) =>
  authoredTools.find((tool) => tool.key === key.toUpperCase());
export const toolTitle = (tool: ToolInfo) => `${tool.label}: ${tool.hint} (${tool.key})`;

/** The canvas interaction a tool installs; terrain tools have interactions of their own. */
export type AuthoredInteraction =
  | "select"
  | "points"
  | "draw"
  | "brush"
  | "heightLine"
  | "heightArea"
  | "peak"
  | "street"
  | "building";
const interactions: Record<AuthoredTool, AuthoredInteraction> = {
  select: "select",
  points: "points",
  landmass: "draw",
  river: "draw",
  plot: "draw",
  street: "street",
  building: "building",
  place: "draw",
  raise: "brush",
  lower: "brush",
  smooth: "brush",
  flatten: "brush",
  set: "brush",
  heightLine: "heightLine",
  heightArea: "heightArea",
  peak: "peak",
};
export const interactionFor = (tool: AuthoredTool): AuthoredInteraction => interactions[tool];
export const isBrush = (tool: AuthoredTool): tool is BrushMode => interactions[tool] === "brush";

/** Brush settings; radius and heights in metres, strength 0 to 1. */
export interface BrushChoice {
  radius: number;
  strength: number;
  /** Read by Flatten and Set. */
  target: number;
  /** Metres a full-strength dab adds or removes. */
  stepHeight: number;
}
/** Height-shape settings. */
export interface ShapeChoice {
  height: number;
  halfWidth: number;
  feather: number;
  peakRadius: number;
}
export interface AuthoredChoice {
  tool: AuthoredTool;
  /** The catalogue kind the Place tool is armed with (a `KindEntry` key), if any. */
  kind: string | null;
  brush: BrushChoice;
  shape: ShapeChoice;
}
const spanOf = ([west, south, east, north]: Bounds) => Math.max(east - west, north - south, 1);
export function defaultAuthored(bounds: Bounds): AuthoredChoice {
  const span = spanOf(bounds);
  return {
    tool: "select",
    kind: null,
    brush: { radius: span / 40, strength: 0.5, target: 0, stepHeight: Math.max(span / 400, 1) },
    shape: {
      height: Math.max(span / 50, 10),
      halfWidth: span / 60,
      feather: span / 40,
      peakRadius: span / 25,
    },
  };
}

/** The brush radius range for a map: a few pixels of a full view up to a fifth of its span. */
export function radiusRange(bounds: Bounds): [number, number] {
  const span = spanOf(bounds);
  return [span / 2000, span / 5];
}
export const clampRadius = (radius: number, bounds: Bounds) => {
  const [least, most] = radiusRange(bounds);
  return Math.min(Math.max(Number.isFinite(radius) ? radius : least, least), most);
};
/** The radius slider is logarithmic: fine steps for small brushes. Position runs 0 to 1. */
export function radiusFromSlider(position: number, bounds: Bounds) {
  const [least, most] = radiusRange(bounds);
  return clampRadius(least * Math.pow(most / least, Math.min(Math.max(position, 0), 1)), bounds);
}
export function sliderFromRadius(radius: number, bounds: Bounds) {
  const [least, most] = radiusRange(bounds);
  return Math.log(clampRadius(radius, bounds) / least) / Math.log(most / least);
}
/** The cursor ring's radius on screen, so a tiny brush stays visible. */
export const ringPixels = (radius: number, resolution: number) =>
  Math.max(radius / Math.max(resolution, Number.EPSILON), 3);
/** A readable length: metres below a kilometre. */
export function formatMetres(metres: number) {
  const size = Math.abs(metres);
  if (size >= 10000) return `${(metres / 1000).toFixed(0)} km`;
  if (size >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}

type Point = [number, number];
/** Keep points at least `spacing` apart, always the first and the last. */
export function thinPoints(points: Point[], spacing: number): Point[] {
  if (points.length < 3) return points;
  const kept: Point[] = [points[0]];
  for (const point of points.slice(1, -1)) {
    const last = kept[kept.length - 1];
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= spacing) kept.push(point);
  }
  kept.push(points[points.length - 1]);
  return kept;
}
/** One brush stroke: the dragged path, thinned to a quarter of the radius. */
export function buildStroke(points: Point[], mode: BrushMode, brush: BrushChoice): Stroke {
  return {
    points: thinPoints(points, brush.radius / 4),
    radius: brush.radius,
    strength: brush.strength,
    mode,
    target: brush.target,
    stepHeight: brush.stepHeight,
  };
}
/** A guide line whose every vertex takes the height field, except those given. */
export function buildHeightLine(
  points: Point[],
  shape: ShapeChoice,
  heights: number[] = []
): HeightLine {
  return {
    points,
    heights: points.map((_, index) => heights[index] ?? shape.height),
    halfWidth: shape.halfWidth,
  };
}
/** An area from one outer ring, closed as GeoJSON rings are. */
export function buildHeightArea(ring: Point[], shape: ShapeChoice): HeightArea {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first && last && (first[0] !== last[0] || first[1] !== last[1]);
  return {
    rings: [closed ? [...ring, first] : ring],
    height: shape.height,
    feather: shape.feather,
  };
}
export const buildPeak = (at: Point, shape: ShapeChoice): HeightPeak => ({
  at,
  height: shape.height,
  radius: shape.peakRadius,
});
export const terrainEdit = {
  stroke: (value: Stroke): TerrainEdit => ({ type: "stroke", value }),
  line: (value: HeightLine): TerrainEdit => ({ type: "line", value }),
  area: (value: HeightArea): TerrainEdit => ({ type: "area", value }),
  peak: (value: HeightPeak): TerrainEdit => ({ type: "peak", value }),
};
