import { rockCodeCount } from "./rockCatalogue";
import type { MaterialLayer } from "./rockLayerFields";
import { CargoMixture, aggregateCargo } from "./materialCargo";

/** One transient contact slab. Keep every constituent until the column's two-kind projection. */
export class MaterialMixture {
  private readonly cargo = new CargoMixture();
  private readonly weights = new Float64Array(rockCodeCount);
  private readonly kinds = new Int32Array(rockCodeCount);
  private kindsUsed = 0;
  private count = 0;
  private weight = 0;
  private strength = 0;
  private damage = 0;
  private grainX = 0;
  private grainY = 0;
  private bedSlopeX = 0;
  private bedSlopeY = 0;
  private consolidation = 0;
  private deposited = -Infinity;
  private formedMin = Infinity;
  private formedMax = -Infinity;
  private altered = -Infinity;
  private mixed = 0;

  reset() {
    this.cargo.clear();
    for (let i = 0; i < this.kindsUsed; i++) this.weights[this.kinds[i]] = 0;
    this.kindsUsed = this.count = this.weight = 0;
    this.strength = this.damage = this.grainX = this.grainY = 0;
    this.bedSlopeX = this.bedSlopeY = this.consolidation = this.mixed = 0;
    this.deposited = this.formedMax = this.altered = -Infinity;
    this.formedMin = Infinity;
  }
  private constituent(kind: number, weight: number) {
    if (weight <= 0) return;
    if (this.weights[kind] === 0) this.kinds[this.kindsUsed++] = kind;
    this.weights[kind] += weight;
  }
  add(layer: MaterialLayer, weight: number) {
    if (weight <= 0) return;
    this.constituent(layer.kind, weight * (1 - layer.secondaryShare));
    this.constituent(layer.secondaryKind, weight * layer.secondaryShare);
    this.count++;
    this.weight += weight;
    this.cargo.add(layer.cargo, weight);
    this.strength += layer.strength * weight;
    this.damage += layer.damage * weight;
    this.grainX += layer.grainX * weight;
    this.grainY += layer.grainY * weight;
    this.bedSlopeX += layer.bedSlopeX * weight;
    this.bedSlopeY += layer.bedSlopeY * weight;
    this.consolidation += layer.consolidation * weight;
    this.deposited = Math.max(this.deposited, layer.deposited);
    this.formedMin = Math.min(this.formedMin, layer.formedMin);
    this.formedMax = Math.max(this.formedMax, layer.formedMax);
    this.altered = Math.max(this.altered, layer.altered);
    this.mixed = Math.max(this.mixed, layer.mixed);
  }
  private constituents() {
    let first = this.kinds[0],
      second = first;
    for (let i = 1; i < this.kindsUsed; i++) {
      const kind = this.kinds[i];
      if (this.weights[kind] > this.weights[first]) {
        second = first;
        first = kind;
      } else if (second === first || this.weights[kind] > this.weights[second]) second = kind;
    }
    const secondary = second === first ? 0 : this.weights[second];
    return {
      kind: first,
      secondaryKind: second,
      secondaryShare: secondary / (this.weights[first] + secondary),
    };
  }
  material(depth: number): MaterialLayer | null {
    if (this.weight <= 0) return null;
    const { kind, secondaryKind, secondaryShare } = this.constituents(),
      inverse = 1 / this.weight;
    return {
      kind,
      secondaryKind,
      secondaryShare,
      depth,
      strength: this.strength * inverse,
      damage: this.damage * inverse,
      grainX: this.grainX * inverse,
      grainY: this.grainY * inverse,
      bedSlopeX: this.bedSlopeX * inverse,
      bedSlopeY: this.bedSlopeY * inverse,
      consolidation: this.consolidation * inverse,
      deposited: this.deposited,
      formedMin: this.formedMin,
      formedMax: this.formedMax,
      altered: this.altered,
      mixed: this.count > 1 ? 1 : this.mixed,
      cargo: aggregateCargo(this.cargo.finish(this.weight), kind, secondaryKind),
    };
  }
}
