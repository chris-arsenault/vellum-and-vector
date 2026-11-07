import type { Band } from "@atlas/domain";
import { compileMix } from "../rock/modes";
import { releaseWorking, workingArray } from "../canonry/physicalNumerics";
import { settle, shed } from "../rock/groundLedger";
import { defineProcess, type ProcessWork } from "./groundProcess";
import { slopeSettings } from "./slopeSettings";

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
    const drop = (field.Elevation.get(i) - field.Elevation.get(j)) / 1024;
    if (drop > 0) send(j, drop, mesh.faceLength(i, edge) / mesh.faceDistance(i, edge));
  }
}
function creepFrom(work: CreepWork, i: number, leaving: Band, arriving: Band) {
  const { field, settings: p, ground, span } = work,
    mesh = field.mesh,
    mantle = (field.SedimentThickness.get(i) / 1024) * mesh.area(i);
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
    leaving.add(i, volume);
    arriving.add(j, volume);
  });
}
export const creep = defineProcess({
  id: "creep",
  statement:
    "Loose cover moves downhill on any slope, faster the steeper it is, slower under roots, which rounds ranges off and fills the low ground.",
  reads,
  asks: [],
  moves: [["loose", "loose"]],
  settings: slopeSettings,
  run(work) {
    const { field, world } = work,
      leaving = workingArray(world, "float64", "creep:leaving"),
      arriving = workingArray(world, "float64", "creep:arriving");
    for (let i = 0; i < field.mesh.count; i++) creepFrom(work, i, leaving, arriving);
    for (let i = 0; i < field.mesh.count; i++) {
      if (leaving.get(i) > 0) shed(world, i, leaving.get(i), "creep");
      if (arriving.get(i) > 0) settle(world, i, arriving.get(i));
    }
    releaseWorking(world, leaving, arriving);
  },
});
