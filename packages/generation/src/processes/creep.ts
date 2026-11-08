import { compileMix } from "../rock/modes";
import { defineProcess, type ProcessWork } from "./groundProcess";
import { creepSettings } from "./creepSettings";
import { MapScale } from "@atlas/domain";

/** Roots hold loose ground together. */
const loosening = compileMix({ shear: 1 });
const reads = ["Elevation", "SedimentThickness", "WaterKindCodes"] as const;
type CreepWork = ProcessWork<(typeof reads)[number]>;

/** What one cell wants to send down each lower neighbour, handed to `send`. */
function eachFall(
  { field }: CreepWork,
  i: number,
  send: (j: number, drop: number, width: number) => void
) {
  const mesh = field.mesh;
  for (let edge = 0; edge < mesh.degree(i); edge++) {
    const j = mesh.neighbor(i, edge);
    if (j < 0) continue;
    const drop = MapScale.metres(field.Elevation.get(i) - field.Elevation.get(j), "native");
    if (drop > 0) send(j, drop, mesh.faceLength(i, edge) / mesh.faceDistance(i, edge));
  }
}
function creepFrom(
  work: CreepWork,
  i: number,
  send: (source: number, target: number, volume: number) => void
) {
  const { field, settings: p, ground, span } = work,
    mesh = field.mesh,
    mantle = MapScale.metres(field.SedimentThickness.get(i), "native") * mesh.area(i);
  if (mantle <= 0 || field.WaterKindCodes.get(i) === 1) return;
  const moves = ground.gives(i, loosening) * p.CreepPerSpan * span;
  let wanted = 0;
  eachFall(work, i, (_, drop, width) => {
    wanted += moves * drop * width;
  });
  if (wanted <= 0) return;
  // A cell cannot send more than it has, and no more than would level it with a neighbour.
  const share = Math.min(1, mantle / wanted);
  eachFall(work, i, (j, drop, width) => {
    const volume = Math.min(
      share * moves * drop * width,
      (drop / 2) * Math.min(mesh.area(i), mesh.area(j))
    );
    send(i, j, volume);
  });
}
export const creep = defineProcess({
  id: "creep",
  statement:
    "Loose cover moves downhill on any slope, faster the steeper it is, slower under roots, which rounds ranges off and fills the low ground.",
  reads,
  asks: ["rootHold"],
  moves: [
    ["loose", "load"],
    ["load", "loose"],
  ],
  settings: creepSettings,
  // A region's passes refine one stretch of the world's history; they do not add more of it.
  forExecution: (settings, { passes }) => ({ CreepPerSpan: settings.CreepPerSpan / passes }),
  run(work) {
    const { field, stage } = work;
    const send = (source: number, target: number, volume: number) =>
      stage.moveLoose(source, target, volume, "creep");
    for (let i = 0; i < field.mesh.count; i++) creepFrom(work, i, send);
  },
});
