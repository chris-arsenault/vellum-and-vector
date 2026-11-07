import type { PhysicalField } from "../world/field";
import { clamp, units } from "../world/math";
import { givenUp, type CompiledMix } from "./modes";
import { layerDepth, layerKind, rockLayers } from "./rockColumn";
import { rockCatalogue, rockKindOfCode, type RockKind } from "./rockCatalogue";

/** The depth of loose sediment that fully covers the rock beneath it, in metres. */
const fullCover = 25;
/** How far each kind of cover binds the ground, and how far burning undoes it. */
const rootHold = { tree: 1.2, grass: 0.45, wetland: 0.7 },
  burntShare = 0.5;
/** The most any ground gives up against ordinary rock: past this, the attack is what limits it. */
const mostGiven = 5;
const loose = rockCatalogue.alluvium;

/** One layer as a query passes it. Reused between layers and cells: read it, do not keep it. */
export interface GroundLayer {
  kind: RockKind;
  /** Its strength where it lies: the surface carries what has been done to it. */
  strength: number;
  /** Its thickness, in the field's height units; the deepest layer's is its record, not its end. */
  thickness: number;
}
/** What lies over and through a cell. */
export interface GroundHere {
  tree: number;
  grass: number;
  wetland: number;
  fire: number;
  /** Open fractures and warding, in [0, 1]. */
  fracture: number;
  ward: number;
  /** How far anything else stiffens this ground, such as a cone's apron on a region. */
  stiffening: number;
}
/**
 * A read of the ground, written by whoever needs it and unknown to `Ground`: a visitor over what lies
 * in the cell, by family. Rock is visited at the surface alone unless `throughColumn`.
 */
export interface GroundQuery<T> {
  readonly start: T;
  readonly loose?: (sofar: T, layer: GroundLayer, here: GroundHere) => T;
  readonly rock?: (sofar: T, layer: GroundLayer, here: GroundHere) => T;
  readonly throughColumn?: boolean;
}
const grounds = new WeakMap<PhysicalField, Ground>();

/**
 * A cell as a stack: cover over sediment over rock, with fractures, wards and anything a map adds
 * bearing on what passes. A process acts down through it and a query reads it, on world and region
 * alike. Everything outside the rock module reads rock here.
 */
export class Ground {
  private stiffen: ((i: number) => number) | null = null;
  /** An action's power not yet spent, and how deep it has reached, in metres. */
  private left = 0;
  private reached = 0;
  private readonly here: GroundHere = {
    tree: 0,
    grass: 0,
    wetland: 0,
    fire: 0,
    fracture: 0,
    ward: 0,
    stiffening: 1,
  };
  private readonly layer: GroundLayer = { kind: rockCatalogue.strata, strength: 0, thickness: 0 };
  constructor(private readonly map: PhysicalField) {}
  /** Something only this map knows stiffens its ground: a region's cones, for one. */
  stiffenBy(stiffen: ((i: number) => number) | null) {
    this.stiffen = stiffen;
  }
  /** How far what lies on this cell changes what a mix does to whatever it reaches. */
  private bearing(i: number, mix: CompiledMix) {
    const map = this.map,
      fracture = clamp(map.FractureConductance.get(i) / 1000, 0, 1),
      ward = clamp(map.Warding.get(i), 0, 1);
    let bearing = Math.exp(mix.fracturesWeaken * fracture) / (1 + mix.wardHolds * ward);
    if (this.stiffen) bearing /= this.stiffen(i);
    if (mix.coverHolds <= 0) return bearing;
    const held =
      (1 +
        mix.coverHolds *
          (map.TreeCover.get(i) * rootHold.tree +
            map.GrassCover.get(i) * rootHold.grass +
            map.WetlandCover.get(i) * rootHold.wetland)) *
      (1 - mix.coverHolds * burntShare * map.FireActivity.get(i));
    return bearing / Math.max(0.1, held);
  }
  private rate(mix: CompiledMix, code: number, strength: number, bearing: number) {
    return clamp(givenUp(mix, code, strength) * bearing, 0, mostGiven);
  }
  /**
   * An action goes down through the cell with the power to move `power` metres of ordinary rock. Each
   * layer gives up what it does and passes on what is left, and a layer that gives nothing lets it
   * through. The answer is how deep it reached, in height units, up to `limit`; the process then
   * lands that through the ledger, as the share of the cell it worked.
   */
  actOn(i: number, mix: CompiledMix, power: number, limit: number) {
    const map = this.map,
      bearing = this.bearing(i, mix),
      sediment = map.SedimentThickness.get(i);
    this.left = power;
    this.reached = 0;
    if (sediment > 0)
      this.take(this.rate(mix, loose.code, loose.resistance, bearing), sediment / 1024);
    if (this.left > 0) this.walkRock(i, mix, bearing);
    return Math.min(units(this.reached), limit);
  }
  private take(rate: number, thickness: number) {
    if (rate <= 0) return;
    const taken = Math.min(thickness, this.left * rate);
    this.reached += taken;
    this.left -= taken / rate;
  }
  /** Down through the column, its basement never running out. */
  private walkRock(i: number, mix: CompiledMix, bearing: number) {
    const map = this.map;
    this.take(
      this.rate(mix, map.RockKindCodes.get(i), map.RockResistance.get(i), bearing),
      this.layerReach(i, 0)
    );
    for (let at = 1; at < rockLayers && this.left > 1e-9 && layerDepth(map, i, at) > 0; at++) {
      const kind = rockKindOfCode(layerKind(map, i, at));
      this.take(this.rate(mix, kind.code, kind.resistance, bearing), this.layerReach(i, at));
    }
  }
  /** How far down a layer goes, in metres; the deepest has no end. */
  private layerReach(i: number, at: number) {
    const deepest = at === rockLayers - 1 || layerDepth(this.map, i, at + 1) <= 0;
    return deepest ? Infinity : layerDepth(this.map, i, at) / 1024;
  }
  /**
   * What this cell's surface gives up to a mix, against ordinary rock's 1, without acting on it:
   * loose cover counts for as much of the surface as it covers.
   */
  gives(i: number, mix: CompiledMix) {
    const map = this.map,
      bearing = this.bearing(i, mix),
      rock = this.rate(mix, map.RockKindCodes.get(i), map.RockResistance.get(i), bearing),
      cover = clamp(map.SedimentThickness.get(i) / units(fullCover), 0, 1);
    return rock + (this.rate(mix, loose.code, loose.resistance, bearing) - rock) * cover;
  }
  /** Reads the ground with a query. */
  fold<T>(i: number, query: GroundQuery<T>): T {
    const map = this.map,
      here = this.here,
      layer = this.layer;
    here.tree = map.TreeCover.get(i);
    here.grass = map.GrassCover.get(i);
    here.wetland = map.WetlandCover.get(i);
    here.fire = map.FireActivity.get(i);
    here.fracture = clamp(map.FractureConductance.get(i) / 1000, 0, 1);
    here.ward = clamp(map.Warding.get(i), 0, 1);
    here.stiffening = this.stiffen ? this.stiffen(i) : 1;
    let sofar = query.start;
    const sediment = map.SedimentThickness.get(i);
    if (query.loose && sediment > 0) {
      layer.kind = loose;
      layer.strength = loose.resistance;
      layer.thickness = sediment;
      sofar = query.loose(sofar, layer, here);
    }
    if (!query.rock) return sofar;
    layer.kind = rockKindOfCode(map.RockKindCodes.get(i));
    layer.strength = map.RockResistance.get(i);
    layer.thickness = layerDepth(map, i, 0);
    sofar = query.rock(sofar, layer, here);
    if (!query.throughColumn) return sofar;
    for (let at = 1; at < rockLayers && layerDepth(map, i, at) > 0; at++) {
      layer.kind = rockKindOfCode(layerKind(map, i, at));
      layer.strength = layer.kind.resistance;
      layer.thickness = layerDepth(map, i, at);
      sofar = query.rock(sofar, layer, here);
    }
    return sofar;
  }
}
/** The ground of a map. */
export function groundOf(map: PhysicalField): Ground {
  let ground = grounds.get(map);
  if (!ground) grounds.set(map, (ground = new Ground(map)));
  return ground;
}
