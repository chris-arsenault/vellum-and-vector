import type { PhysicalField } from "../world/field";
import { clamp, units } from "../world/math";
import { givenUp, type CompiledMix } from "./modes";
import { layerDepth, layerKind, rockLayers } from "./rockColumn";
import { rockCatalogue, rockKindOfCode, type RockKind } from "./rockCatalogue";

/** The depth of loose sediment that fully covers the rock beneath it, in metres. */
const fullCover = 25;
/** The depth of soil that is all a surface shows, in metres. */
const fullSoil = 1;
/** How far burning undoes what roots hold. */
const burntShare = 0.5;
/**
 * Below this share of its ground's hold left, cover is gone: numerical, since fire at full strength
 * against a strongly held mix would otherwise divide by nothing.
 */
const leastHold = 0.1;
const loose = rockCatalogue.alluvium,
  soil = rockCatalogue.soil;

/** One layer as a query passes it. Reused between layers and cells: read it, do not keep it. */
export interface GroundLayer {
  kind: RockKind;
  /** Its strength where it lies: the surface carries what has been done to it. */
  strength: number;
  /** Its thickness, in the field's height units; the deepest layer's is its record, not its end. */
  thickness: number;
}
/** What an action took from each layer of a cell, in metres: the last action on it. */
export interface GroundTaken {
  soil: number;
  loose: number;
  ice: number;
  rock: number;
  crust: number;
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
type Visit<T> = (sofar: T, layer: GroundLayer, here: GroundHere) => T;
/**
 * A read of the ground, written by whoever needs it and unknown to `Ground`: a visitor over what lies
 * in the cell, top down: soil, loose sediment, ice, the rock column and the crust beneath it. Rock is
 * visited at the surface alone unless `throughColumn`, and the crust only through the column.
 */
export interface GroundQuery<T> {
  readonly start: T;
  readonly soil?: Visit<T>;
  readonly loose?: Visit<T>;
  readonly ice?: Visit<T>;
  readonly rock?: Visit<T>;
  readonly crust?: Visit<T>;
  readonly throughColumn?: boolean;
}
const grounds = new WeakMap<PhysicalField, Ground>();

/**
 * A cell as a stack: plant cover over soil over loose sediment over ice over the rock column over the
 * crust, with fractures, wards and anything a map adds bearing on what passes. A process acts down
 * through it and a query reads it, on world and region alike. Everything outside the rock module reads
 * rock here.
 */
export class Ground {
  private stiffen: ((i: number) => number) | null = null;
  /** How far roots bind each cell, as the world answers it; nothing holds where none is given. */
  private hold: { get(i: number): number } | null = null;
  /** An action's power not yet spent, and how deep it has reached, in metres. */
  private left = 0;
  private reached = 0;
  private at: keyof GroundTaken = "rock";
  private readonly took: GroundTaken = { soil: 0, loose: 0, ice: 0, rock: 0, crust: 0 };
  private tookAt = -1;
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
  /** What roots hold the ground with, as the world answers `rootHold`, for the actions to come. */
  heldBy(hold: { get(i: number): number } | null) {
    this.hold = hold;
  }
  /** How far what lies on this cell changes what a mix does to whatever it reaches. */
  private bearing(i: number, mix: CompiledMix) {
    const map = this.map,
      fracture = clamp(map.FractureConductance.get(i) / 1000, 0, 1),
      ward = clamp(map.Warding.get(i), 0, 1);
    let bearing = Math.exp(mix.fracturesWeaken * fracture) / (1 + mix.wardHolds * ward);
    if (this.stiffen) bearing /= this.stiffen(i);
    if (mix.coverHolds <= 0 || !this.hold) return bearing;
    const held =
      (1 + mix.coverHolds * this.hold.get(i)) *
      (1 - mix.coverHolds * burntShare * map.FireActivity.get(i));
    return bearing / Math.max(leastHold, held);
  }
  private rate(mix: CompiledMix, code: number, strength: number, bearing: number) {
    return Math.max(0, givenUp(mix, code, strength) * bearing);
  }
  /**
   * An action goes down through the cell with the power to move `power` metres of ordinary rock. Each
   * layer gives up what it does and passes on what is left, and a layer that gives nothing lets it
   * through: soil, then loose sediment, past any ice, then the rock column, then the crust beneath,
   * which never runs out. The answer is how deep it reached, in height units, up to `limit`; the
   * process then lands that through the ledger, as the share of the cell it worked.
   */
  actOn(i: number, mix: CompiledMix, power: number, limit: number) {
    const map = this.map,
      bearing = this.bearing(i, mix),
      sediment = map.SedimentThickness.get(i) / 1024,
      skin = map.SoilDepth.get(i);
    this.left = power;
    this.reached = 0;
    this.start(i);
    this.at = "soil";
    if (skin > 0) this.take(this.rate(mix, soil.code, soil.resistance, bearing), skin);
    this.at = "loose";
    if (sediment > skin)
      this.take(this.rate(mix, loose.code, loose.resistance, bearing), sediment - skin);
    if (this.left > 0) this.walkRock(i, mix, bearing, Math.max(0, skin - sediment));
    return Math.min(units(this.reached), limit);
  }
  /** What the last action on this cell took from each layer, in metres. */
  taken(i: number): Readonly<GroundTaken> {
    if (this.tookAt !== i) this.start(i);
    return this.took;
  }
  private start(i: number) {
    this.tookAt = i;
    this.took.soil = this.took.loose = this.took.ice = this.took.rock = this.took.crust = 0;
  }
  private take(rate: number, thickness: number) {
    if (rate <= 0 || thickness <= 0) return;
    const taken = Math.min(thickness, this.left * rate);
    this.reached += taken;
    this.took[this.at] += taken;
    this.left -= taken / rate;
  }
  /** Down through the column, less what soil has made of its top, and on into the crust. */
  private walkRock(i: number, mix: CompiledMix, bearing: number, soiled: number) {
    const map = this.map;
    this.at = "rock";
    this.take(
      this.rate(mix, map.RockKindCodes.get(i), map.RockResistance.get(i), bearing),
      this.layerReach(i, 0) - soiled
    );
    let deepest = map.RockKindCodes.get(i);
    for (let at = 1; at < rockLayers && this.left > 1e-9 && layerDepth(map, i, at) > 0; at++) {
      const kind = rockKindOfCode(layerKind(map, i, at));
      deepest = kind.code;
      this.take(this.rate(mix, kind.code, kind.resistance, bearing), this.layerReach(i, at));
    }
    if (this.left <= 1e-9) return;
    const basement = rockKindOfCode(deepest);
    this.at = "crust";
    this.take(this.rate(mix, basement.code, basement.resistance, bearing), Infinity);
  }
  /** How far down a recorded layer goes, in metres. */
  private layerReach(i: number, at: number) {
    return layerDepth(this.map, i, at) / 1024;
  }
  /**
   * What this cell's surface gives up to a mix, against ordinary rock's 1, without acting on it:
   * loose cover counts for as much of the surface as it covers.
   */
  gives(i: number, mix: CompiledMix) {
    const map = this.map,
      bearing = this.bearing(i, mix),
      rock = this.rate(mix, map.RockKindCodes.get(i), map.RockResistance.get(i), bearing),
      cover = clamp(map.SedimentThickness.get(i) / units(fullCover), 0, 1),
      beneath = rock + (this.rate(mix, loose.code, loose.resistance, bearing) - rock) * cover,
      skin = clamp(map.SoilDepth.get(i) / fullSoil, 0, 1);
    return beneath + (this.rate(mix, soil.code, soil.resistance, bearing) - beneath) * skin;
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
    const sofar = this.foldCover(i, query);
    if (!query.rock) return sofar;
    layer.kind = rockKindOfCode(map.RockKindCodes.get(i));
    layer.strength = map.RockResistance.get(i);
    layer.thickness = layerDepth(map, i, 0);
    return this.foldColumn(i, query, query.rock(sofar, layer, here));
  }
  /** What lies over the rock: soil, loose sediment and ice, each where there is any. */
  private foldCover<T>(i: number, query: GroundQuery<T>) {
    const map = this.map,
      here = this.here,
      sediment = map.SedimentThickness.get(i),
      skin = map.SoilDepth.get(i),
      ice = map.IceThickness.get(i);
    let sofar = query.start;
    if (query.soil && skin > 0) sofar = query.soil(sofar, this.as(soil, units(skin)), here);
    if (query.loose && sediment > 0) sofar = query.loose(sofar, this.as(loose, sediment), here);
    if (query.ice && ice > 0)
      sofar = query.ice(sofar, this.as(rockCatalogue.glacierIce, units(ice)), here);
    return sofar;
  }
  /** Down the column beneath the surface rock, and on to the crust under its deepest layer. */
  private foldColumn<T>(i: number, query: GroundQuery<T>, from: T) {
    const map = this.map,
      layer = this.layer;
    let sofar = from;
    if (!query.throughColumn) return sofar;
    for (let at = 1; at < rockLayers && layerDepth(map, i, at) > 0; at++) {
      layer.kind = rockKindOfCode(layerKind(map, i, at));
      layer.strength = layer.kind.resistance;
      layer.thickness = layerDepth(map, i, at);
      sofar = query.rock!(sofar, layer, this.here);
    }
    if (!query.crust) return sofar;
    layer.strength = layer.kind.resistance;
    layer.thickness = map.CrustThickness.get(i);
    return query.crust(sofar, layer, this.here);
  }
  private as(kind: RockKind, thickness: number) {
    this.layer.kind = kind;
    this.layer.strength = kind.resistance;
    this.layer.thickness = thickness;
    return this.layer;
  }
}
/** The ground of a map. */
export function groundOf(map: PhysicalField): Ground {
  let ground = grounds.get(map);
  if (!ground) grounds.set(map, (ground = new Ground(map)));
  return ground;
}
