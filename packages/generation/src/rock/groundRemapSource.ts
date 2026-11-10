import type { PhysicalField } from "../world/field";
import type { TransportPlan } from "../world/transportPlan";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { columnFields, columns, type Column, type MaterialLayer } from "./rockLayerFields";
import { deformFabric, deformSlope, type Deformation } from "./groundTransform";
import { heldProperty, type HeldRock } from "./groundTransport";
import { releaseCargoCustody } from "./groundCargoIdentity";

const slots = columns.reduce((count, column) => count + columnFields[column].depth.length, 0);
let offset = 0;
// hpc-exempt: four fixed schema offsets into operation-local numerical scratch.
const starts = Object.fromEntries(
  columns.map((column) => {
    const start = offset;
    offset += columnFields[column].depth.length;
    return [column, start];
  })
) as Record<Column, number>;
type WritableLayer = { -readonly [P in keyof MaterialLayer]: MaterialLayer[P] };

/**
 * Only transformed orientation is cached. Composition, depth and history still read the captured
 * Ground bands. A source is prepared once for the immutable transport plan, regardless of how many
 * destinations overlap it; empty slots never decode a whole material record.
 */
export class RemapSource {
  private readonly ready;
  private readonly occupied;
  private readonly orientation;
  constructor(
    private readonly map: PhysicalField,
    private readonly held: HeldRock,
    private readonly plan: TransportPlan
  ) {
    this.ready = workingArray(map, "uint8", "remap:ready").fill(0);
    this.occupied = workingArray(map, "uint8", "remap:occupied", map.mesh.count * columns.length);
    this.orientation = workingArray(
      map,
      "float64",
      "remap:orientation",
      map.mesh.count * slots * 4
    );
  }
  private prepare(source: number) {
    if (this.ready.get(source)) return;
    const plan = this.plan,
      f: Deformation = [
        plan.deformationXX.get(source),
        plan.deformationXY.get(source),
        plan.deformationYX.get(source),
        plan.deformationYY.get(source),
      ];
    for (let column = 0; column < columns.length; column++) this.prepareColumn(source, column, f);
    this.ready.set(source, 1);
  }
  private prepareColumn(source: number, column: number, f: Deformation) {
    const name = columns[column],
      fields = columnFields[name];
    let mask = 0;
    for (let slot = 0; slot < fields.depth.length; slot++) {
      if (heldProperty(this.held, fields.depth[slot], source) <= 0) continue;
      mask |= 1 << slot;
      const at = (source * slots + starts[name] + slot) * 4,
        read = (property: "grainX" | "grainY" | "bedSlopeX" | "bedSlopeY") =>
          heldProperty(this.held, fields[property][slot], source),
        [x, y] = deformFabric(read("grainX"), read("grainY"), f),
        [sx, sy] = deformSlope(read("bedSlopeX"), read("bedSlopeY"), f);
      this.orientation.set(at, x);
      this.orientation.set(at + 1, y);
      this.orientation.set(at + 2, sx);
      this.orientation.set(at + 3, sy);
    }
    this.occupied.set(source * columns.length + column, mask);
  }
  layers(source: number, column: Column): MaterialLayer[] {
    this.prepare(source);
    const mask = this.occupied.get(source * columns.length + columns.indexOf(column)),
      layers: MaterialLayer[] = [];
    for (let slot = 0; slot < columnFields[column].depth.length; slot++) {
      if (!(mask & (1 << slot))) continue;
      const at = (source * slots + starts[column] + slot) * 4,
        layer: WritableLayer = this.held.read(source, slot, column);
      layer.cargo = releaseCargoCustody(this.map, layer.cargo);
      layer.grainX = this.orientation.get(at);
      layer.grainY = this.orientation.get(at + 1);
      layer.bedSlopeX = this.orientation.get(at + 2);
      layer.bedSlopeY = this.orientation.get(at + 3);
      layers.push(layer);
    }
    return layers;
  }
  close() {
    releaseWorking(this.map, this.ready, this.occupied, this.orientation);
  }
}
