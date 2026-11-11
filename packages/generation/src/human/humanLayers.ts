import { requireThat, type Band, type HumanLayerId, type ReadBand } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { TransportPlan } from "../world/transportPlan";
import { carryLayers } from "./humanCarry";
import { buryLayers, reExposeLayers, wearLayers } from "./humanLoss";
import {
  arriveInColumn,
  overlayColumn,
  partColumn,
  reExposeColumn,
  type IdentityColumn,
  type IdentityLayer,
  type IdentityTraditions,
} from "./identityColumn";
import { LayerBands, positive, unit } from "./layerBands";
import {
  forgottenGround,
  layerCatalogue,
  wayMemoryYears,
  type CompiledLayerMix,
} from "./layerCatalogue";

type Values = Pick<ReadBand, "get">;

/** What anyone may read of a map's human layers beyond the bands themselves. */
export interface HumanLayerReads {
  /** The share of a cell's area no layer has taken. */
  freeArea(cell: number): number;
  /** How far a cell's built place stands, against a place at its fullest (0 to 1). */
  standing(cell: number): number;
  /** A cell's identity column, newest layer first. */
  column(cell: number): IdentityColumn;
}
/**
 * The people's layers of one map and the only code that changes them. Everything else reads
 * the bands, asks the shared questions, and submits the registered operations.
 */
class HumanLayers {
  constructor(private readonly layers: LayerBands) {}

  /** What leaves each cell for its target, with the identities that go with it. */
  private depart(kind: HumanLayerId, targets: Values, share: Values, leaving: Band) {
    const band = this.layers.of[kind],
      carried = new Map<number, IdentityLayer[]>();
    for (let cell = 0; cell < band.length; cell++) {
      const target = targets.get(cell),
        part = target === cell || !this.layers.ground(target) ? 0 : unit(share.get(cell));
      if (!part || !(band.get(cell) > 0)) continue;
      leaving.set(cell, band.get(cell) * part);
      if (!layerCatalogue[kind].carriesIdentity) continue;
      const column = this.layers.column(cell),
        parted = partColumn(column, part);
      for (const layer of parted) layer.people *= this.layers.across(cell, target);
      this.layers.writeColumn(cell, column);
      carried.set(target, [...(carried.get(target) ?? []), ...parted]);
    }
    return carried;
  }
  /** Those who leave a cell and those who reach one wear the way under them. */
  private walk(kind: HumanLayerId, cell: number, density: number, years: number) {
    const ways = layerCatalogue[kind].ground?.ways;
    if (ways) this.layers.map[ways].add(cell, density * this.layers.km2(cell) * positive(years));
  }

  /** More of a kind is put on the land. */
  lay(kind: HumanLayerId, amount: Values) {
    const band = this.layers.of[kind];
    for (let cell = 0; cell < band.length; cell++) {
      const added = Math.min(positive(amount.get(cell)), this.layers.room(kind, cell));
      if (added > 0) band.add(cell, added);
    }
  }
  /**
   * A share of each cell's holding of a kind goes to the cell's target, all cells at once.
   * What a target has no room for is lost. People take their identities with them, and
   * wear the ground they cross for the `years` the movement stands for.
   */
  move(kind: HumanLayerId, targets: Values, share: Values, years: number) {
    const band = this.layers.of[kind],
      leaving = this.layers.map.coverage.scratch("float64", "human:leaving", band.length);
    leaving.fill(0);
    const carried = this.depart(kind, targets, share, leaving);
    for (let cell = 0; cell < band.length; cell++) band.add(cell, -leaving.get(cell));
    for (let cell = 0; cell < band.length; cell++) {
      const left = leaving.get(cell);
      if (left <= 0) continue;
      const target = targets.get(cell),
        arriving = left * this.layers.across(cell, target);
      band.add(target, Math.min(arriving, this.layers.room(kind, target)));
      this.walk(kind, cell, left, years);
      this.walk(kind, target, arriving, years);
    }
    for (const [target, arrivals] of carried)
      this.layers.writeColumn(target, arriveInColumn(this.layers.column(target), arrivals));
    this.layers.map.coverage.release(leaving);
  }
  /** Some of the land under one use is put to another, where it lies. */
  convert(from: HumanLayerId, to: HumanLayerId, amount: Values) {
    requireThat(
      layerCatalogue[from].measure === "area" && layerCatalogue[to].measure === "area",
      "human_layer_measure",
      "Only land in use converts, and only into another use of land."
    );
    const source = this.layers.of[from],
      result = this.layers.of[to];
    for (let cell = 0; cell < source.length; cell++) {
      const changed = Math.min(positive(amount.get(cell)), source.get(cell));
      if (changed <= 0) continue;
      source.add(cell, -changed);
      result.add(cell, changed);
    }
  }
  /** A new identity layer is laid over each cell's column, taken up by `people` of those there. */
  overlay(traditions: IdentityTraditions, people: Values, hardness: number) {
    for (let cell = 0; cell < this.layers.count; cell++) {
      const taking = positive(people.get(cell));
      if (!taking) continue;
      const column = this.layers.column(cell);
      let held = 0;
      for (const layer of column) held += layer.people;
      overlayColumn(column, traditions, taking, unit(hardness), this.layers.people(cell) - held);
      this.layers.writeColumn(cell, column);
    }
  }
  /** The newest identity layers lose people, who fall back to the layer beneath. */
  reExposeIdentity(people: Values) {
    for (let cell = 0; cell < this.layers.count; cell++) {
      const leaving = positive(people.get(cell));
      if (leaving) this.layers.writeColumn(cell, reExposeColumn(this.layers.column(cell), leaving));
    }
  }
  wear(mix: CompiledLayerMix, intensity: Values) {
    wearLayers(this.layers, mix, intensity);
  }
  bury(covered: Values) {
    buryLayers(this.layers, covered);
  }
  reExpose(share: Values) {
    reExposeLayers(this.layers, share);
  }
  carry(plan: TransportPlan) {
    carryLayers(this.layers, plan);
  }
  /**
   * Time passes where people live: the ground keeps the years they have lived on it, and ways
   * and kept lines nobody renews are forgotten.
   */
  dwell(years: number) {
    const elapsed = positive(years),
      keep = Math.exp(-elapsed / wayMemoryYears),
      map = this.layers.map;
    for (const [kind, band] of Object.entries(this.layers.of)) {
      const tenure = layerCatalogue[kind as HumanLayerId].ground?.tenure;
      if (!tenure) continue;
      for (let cell = 0; cell < band.length; cell++)
        if (band.get(cell) > 0)
          map[tenure].add(cell, band.get(cell) * this.layers.km2(cell) * elapsed);
    }
    for (const kept of forgottenGround)
      for (let cell = 0; cell < map[kept].length; cell++)
        map[kept].set(cell, map[kept].get(cell) * keep);
  }
}
export type HumanLayerWriter = HumanLayers;
interface Owned {
  bands: LayerBands;
  writer: HumanLayers;
}
// hpc-exempt: one owner per map; the map's lifetime is the owner's.
const owners = new WeakMap<PhysicalField, Owned>();
function owned(map: PhysicalField) {
  let own = owners.get(map);
  if (!own) {
    const bands = new LayerBands(map);
    owners.set(map, (own = { bands, writer: new HumanLayers(bands) }));
  }
  return own;
}
/** What may be read of a map's human layers. */
export const humanLayersOf = (map: PhysicalField): HumanLayerReads => owned(map).bands;
/** The changes to a map's human layers. Only the registered operations may ask for this. */
export const humanLayerWriter = (map: PhysicalField): HumanLayerWriter => owned(map).writer;
