import type { PhysicalField } from "../world/field";
import { MapScale, rockLayers } from "@atlas/domain";
import { meshDeltaX } from "../world/mesh";
import { clamp, units } from "../world/math";
import { givenUp, materialGives, type CompiledMix } from "./modes";
import { columnSize, deepestLayer, layerDepth, materialStrength, readLayer } from "./rockColumn";
import { rockCatalogue, rockKindOfCode, type RockKind } from "./rockCatalogue";
import { createGroundLayer, resetGroundLayer } from "./groundQuery";
import type { GroundHere, GroundQuery } from "./groundQuery";
import { supportFailureDepth } from "./groundFailure";
import { extractableDepth } from "./groundExtraction";
export type { GroundHere, GroundLayer, GroundQuery } from "./groundQuery";
import {
  coverColumn,
  columnThickness,
  cutShare,
  facetShare,
  facetSurface,
  groundSection,
  type GroundFacet,
} from "./groundShares";

/** The depth of loose sediment that fully covers the rock beneath it, in metres. */
const fullCover = 0.00000625;
/** The depth of soil that is all a surface shows, in metres. */
const fullSoil = 0.00000025;
/** How far burning undoes what roots hold. */
const burntShare = 0.5;
const soil = rockCatalogue.soil;

/** What an action took from each layer of a cell, in metres: the last action on it. */
export interface GroundTaken {
  soil: number;
  loose: number;
  ice: number;
  rock: number;
  crust: number;
}
/** Horizontal displacement of the acting carrier, in the field's coordinate frame. */
export type GroundDirection = readonly [number, number];
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
  private limit = Infinity;
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
  private readonly layer = createGroundLayer(rockCatalogue.strata, 0);
  constructor(private readonly map: PhysicalField) {}
  /** Ordered retained material and its absolute contacts, including the surviving cell shares. */
  section(i: number, facet: GroundFacet = "land") {
    return groundSection(this.map, i, facet);
  }
  /** Loose overburden in height units, without constructing an inspection section. */
  coverDepth(i: number, facet: GroundFacet) {
    return columnThickness(this.map, i, coverColumn(facet));
  }
  surface(i: number, facet: GroundFacet) {
    return facetSurface(this.map, i, facet);
  }
  share(i: number, facet: GroundFacet) {
    return facetShare(this.map, i, facet);
  }
  /** The existing soil skin's represented share, independent of the material beneath it. */
  soilShare(i: number) {
    return clamp(this.map.SoilDepth.get(i) / this.map.scale.length(fullSoil), 0, 1);
  }
  /** Supported read surface contains no mutable Band alias, including through retained views. */
  view(name: "Elevation" | "BedrockElevation" | "SedimentThickness" | "RockResistance") {
    const band = this.map[name];
    return Object.freeze({ length: band.length, get: (i: number) => band.get(i) });
  }
  /** Exposed neighbor contacts, area-weighted; no subcell edge position is asserted. */
  face(i: number, neighbor: number) {
    const exposed = [] as ReturnType<Ground["section"]>;
    for (const facet of ["land", "cut"] as const) {
      const section = this.section(i, facet);
      for (const beside of ["land", "cut"] as const) {
        const share = facetShare(this.map, neighbor, beside);
        if (share <= 0) continue;
        const floor = facetSurface(this.map, neighbor, beside);
        for (const layer of section) {
          const bottom = Math.max(floor, layer.basement ? -Infinity : layer.bottom);
          if (layer.top > bottom)
            exposed.push({
              ...layer,
              bottom,
              depth: layer.top - bottom,
              share: layer.share * share,
            });
        }
      }
    }
    return exposed;
  }
  /** Existing slope failure reads exposed support rather than pretending a face is all cap rock. */
  faceGives(i: number, neighbor: number, mix: CompiledMix) {
    return this.faceGivesFrom(i, mix)(neighbor);
  }
  /** Read one unchanged source against its neighbors; discard before material settlement. */
  faceGivesFrom(i: number, mix: CompiledMix) {
    const mesh = this.map.mesh,
      sourceX = mesh.x(i),
      sourceY = mesh.y(i),
      layers = [...this.section(i, "land"), ...this.section(i, "cut")],
      bearing = this.bearing(i, mix);
    let unexposed: number | undefined;
    return (neighbor: number) => {
      let response = 0,
        extent = 0;
      const x = meshDeltaX(mesh, mesh.x(neighbor) - sourceX),
        y = mesh.y(neighbor) - sourceY,
        landShare = this.share(neighbor, "land"),
        cutShare = this.share(neighbor, "cut"),
        landFloor = this.surface(neighbor, "land"),
        cutFloor = this.surface(neighbor, "cut");
      for (const layer of layers) {
        const bottom = layer.basement ? -Infinity : layer.bottom,
          weight =
            layer.share *
            (Math.max(0, layer.top - Math.max(landFloor, bottom)) * landShare +
              Math.max(0, layer.top - Math.max(cutFloor, bottom)) * cutShare);
        if (weight <= 0) continue;
        response += materialGives(mix, layer, layer.medium === "loose", x, y) * weight;
        extent += weight;
      }
      return extent > 0 ? (response / extent) * bearing : (unexposed ??= this.gives(i, mix));
    };
  }
  /** A finite slab can fail above an exposed weak foundation, independently on each surface. */
  failureDepth(
    i: number,
    neighbor: number,
    facet: GroundFacet,
    mix: CompiledMix,
    run: number,
    stable: number
  ) {
    return this.failureFrom(i, facet, mix)(neighbor, run, stable);
  }
  /** One unchanged source facet evaluated against several neighbors. Discard before settlement. */
  failureFrom(i: number, facet: GroundFacet, mix: CompiledMix) {
    const mesh = this.map.mesh,
      section = this.section(i, facet),
      bearing = this.bearing(i, mix),
      x = mesh.x(i),
      y = mesh.y(i);
    return (neighbor: number, run: number, stable: number) => {
      // Without subcell edge locations, an occupied higher neighbor can still buttress this face.
      let floor = -Infinity;
      for (const part of ["land", "cut"] as const)
        if (this.share(neighbor, part) > 0) floor = Math.max(floor, this.surface(neighbor, part));
      return supportFailureDepth(
        section,
        floor,
        [meshDeltaX(mesh, mesh.x(neighbor) - x), mesh.y(neighbor) - y],
        run,
        stable / bearing,
        mix
      );
    };
  }
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
    // Burning removes root support; the material's own resistance remains when roots are gone.
    const remaining = this.hold.get(i) * Math.max(0, 1 - burntShare * map.FireActivity.get(i));
    return bearing / (1 + mix.coverHolds * remaining);
  }
  private rate(mix: CompiledMix, code: number, strength: number, bearing: number) {
    return Math.max(0, givenUp(mix, code, strength) * bearing);
  }
  /**
   * An action goes down through the cell with the power to move `power` metres of ordinary rock. Each
   * layer gives up what it does and passes on what is left only after removal. Unresponsive material
   * blocks this top-down action: soil, then loose sediment, past any ice, then rock and the crust,
   * which never runs out. The answer is how deep it reached, in height units, up to `limit`; the
   * process then lands that through the ledger, as the share of the cell it worked.
   */
  actOn(
    i: number,
    mix: CompiledMix,
    power: number,
    limit: number,
    facet: GroundFacet = cutShare(this.map, i) > 0.5 ? "cut" : "land",
    direction: GroundDirection = [0, 0]
  ) {
    const bearing = this.bearing(i, mix),
      part = facet === "cut" && cutShare(this.map, i) <= 0 ? "land" : facet;
    this.left = power;
    this.reached = 0;
    this.limit = MapScale.metres(limit, "native");
    this.start(i);
    const skin = Math.max(0, this.map.SoilDepth.get(i));
    this.at = "soil";
    this.take(this.rate(mix, soil.code, soil.resistance, bearing), skin);
    this.at = "loose";
    const cover = coverColumn(part);
    let masked = skin;
    for (let slot = 0; slot < columnSize(cover) && this.left > 0; slot++) {
      const layer = readLayer(this.map, i, slot, cover);
      const depth = MapScale.metres(layer.depth, "native"),
        exposed = Math.max(0, depth - masked);
      masked = Math.max(0, masked - depth);
      if (exposed > 0) this.take(materialGives(mix, layer, true, ...direction) * bearing, exposed);
    }
    if (this.left > 0)
      this.walkRock(
        i,
        mix,
        bearing,
        part,
        Math.max(0, skin - MapScale.metres(columnThickness(this.map, i, cover), "native")),
        direction
      );
    return Math.min(units(this.reached), limit);
  }
  /** Forcing reaching rock beneath cover; the caller supplies attenuation through that cover. */
  rockAction(
    i: number,
    mix: CompiledMix,
    power: number,
    limit: number,
    facet: GroundFacet,
    direction: GroundDirection = [0, 0]
  ) {
    this.left = power;
    this.reached = 0;
    this.limit = MapScale.metres(limit, "native");
    this.start(i);
    if (facetShare(this.map, i, facet) <= 0) return 0;
    this.walkRock(i, mix, this.bearing(i, mix), facet, 0, direction);
    return Math.min(units(this.reached), limit);
  }
  /** Each occupied surface answers the same forcing before either material stack is changed. */
  surfaceAction(
    i: number,
    mix: CompiledMix,
    power: number,
    limit: number,
    minimumSurface = -Infinity,
    direction: GroundDirection = [0, 0]
  ): readonly [number, number] {
    const depth = (facet: GroundFacet) =>
      facetShare(this.map, i, facet) > 0
        ? this.actOn(
            i,
            mix,
            power,
            Math.min(limit, Math.max(0, facetSurface(this.map, i, facet) - minimumSurface)),
            facet,
            direction
          )
        : 0;
    return [depth("land"), depth("cut")];
  }
  /** What the last action on this cell took from each layer, in metres. */
  taken(i: number): Readonly<GroundTaken> {
    if (this.tookAt !== i) this.start(i);
    return { ...this.took };
  }
  private start(i: number) {
    this.tookAt = i;
    this.took.soil = this.took.loose = this.took.ice = this.took.rock = this.took.crust = 0;
  }
  private take(rate: number, thickness: number) {
    if (thickness <= 0) return;
    if (rate <= 0) {
      this.left = 0;
      return;
    }
    const taken = Math.max(0, Math.min(thickness, this.left * rate, this.limit - this.reached));
    this.reached += taken;
    this.took[this.at] += taken;
    this.left -= taken / rate;
  }
  /** Down through the column, less what soil has made of its top, and on into the crust. */
  private walkRock(
    i: number,
    mix: CompiledMix,
    bearing: number,
    facet: GroundFacet,
    masked = 0,
    direction: GroundDirection = [0, 0]
  ) {
    const last = deepestLayer(this.map, i, facet);
    for (let at = 0; at <= last && this.left > 0 && this.reached < this.limit; at++) {
      const layer = readLayer(this.map, i, at, facet);
      this.at = at === last ? "crust" : "rock";
      const depth = at === last ? Infinity : MapScale.metres(layer.depth, "native");
      this.take(
        materialGives(mix, layer, false, ...direction) * bearing,
        Math.max(0, depth - masked)
      );
      masked = Math.max(0, masked - depth);
    }
  }
  /**
   * What this cell's surface gives up to a mix, against ordinary rock's 1, without acting on it:
   * loose cover counts for as much of the surface as it covers.
   */
  gives(i: number, mix: CompiledMix) {
    const map = this.map,
      bearing = this.bearing(i, mix),
      share = cutShare(map, i),
      beneath =
        bearing *
        ((1 - share) * this.facetGives(i, mix, "land") + share * this.facetGives(i, mix, "cut")),
      skin = this.soilShare(i);
    return beneath + (this.rate(mix, soil.code, soil.resistance, bearing) - beneath) * skin;
  }
  private facetGives(i: number, mix: CompiledMix, facet: GroundFacet) {
    const rock = materialGives(mix, readLayer(this.map, i, 0, facet)),
      cover = coverColumn(facet),
      share = clamp(
        columnThickness(this.map, i, cover) / units(this.map.scale.length(fullCover)),
        0,
        1
      );
    return rock + (materialGives(mix, readLayer(this.map, i, 0, cover), true) - rock) * share;
  }
  /** Reads the ground with a query. */
  fold<T>(i: number, query: GroundQuery<T>, facet?: GroundFacet): T {
    const share = cutShare(this.map, i);
    if (facet === undefined && query.acrossFacets && share > 0 && share < 1)
      return query.acrossFacets(this.fold(i, query, "land"), this.fold(i, query, "cut"), share);
    facet ??= share > 0.5 ? "cut" : "land";
    if (facetShare(this.map, i, facet) <= 0) return query.start;
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
    const sofar = this.foldCover(i, query, facet);
    if (!query.rock) return sofar;
    const material = readLayer(map, i, 0, facet);
    layer.kind = rockKindOfCode(material.kind);
    layer.material = material;
    layer.strength = materialStrength(material);
    layer.thickness = material.depth;
    layer.retainedThickness = extractableDepth(material, layerDepth(map, i, 1, facet) <= 0);
    return this.foldColumn(i, query, query.rock(sofar, layer, here), facet);
  }
  /** What lies over the rock: soil, loose sediment and ice, each where there is any. */
  private foldCover<T>(i: number, query: GroundQuery<T>, facet: GroundFacet) {
    const map = this.map,
      here = this.here,
      skin = map.SoilDepth.get(i),
      ice = map.IceThickness.get(i);
    let sofar = query.start;
    if (query.soil && skin > 0) sofar = query.soil(sofar, this.as(soil, units(skin)), here);
    const cover = coverColumn(facet),
      count = query.throughColumn ? columnSize(cover) : 1;
    for (let slot = 0; query.loose && slot < count; slot++) {
      const material = readLayer(map, i, slot, cover);
      if (material.depth <= 0) continue;
      const layer = this.as(
        rockKindOfCode(material.kind),
        query.throughColumn ? material.depth : columnThickness(map, i, cover)
      );
      layer.strength = materialStrength(material, true);
      layer.material = material;
      sofar = query.loose(sofar, layer, here);
    }
    if (query.ice && ice > 0)
      sofar = query.ice(sofar, this.as(rockCatalogue.glacierIce, units(ice)), here);
    return sofar;
  }
  /** Down the column beneath the surface rock, and on to the crust under its deepest layer. */
  private foldColumn<T>(i: number, query: GroundQuery<T>, from: T, facet: GroundFacet) {
    const map = this.map,
      layer = this.layer;
    let sofar = from;
    if (!query.throughColumn) return sofar;
    for (let at = 1; at < rockLayers && layerDepth(map, i, at, facet) > 0; at++) {
      const material = readLayer(map, i, at, facet);
      layer.kind = rockKindOfCode(material.kind);
      layer.material = material;
      layer.strength = materialStrength(material);
      layer.thickness = material.depth;
      layer.retainedThickness = extractableDepth(
        material,
        at + 1 === rockLayers || layerDepth(map, i, at + 1, facet) <= 0
      );
      sofar = query.rock!(sofar, layer, this.here);
    }
    if (!query.crust) return sofar;
    layer.thickness = map.CrustThickness.get(i);
    layer.retainedThickness = 0;
    return query.crust(sofar, layer, this.here);
  }
  private as(kind: RockKind, thickness: number) {
    return resetGroundLayer(this.layer, kind, thickness);
  }
}
/** The ground of a map. */
export function groundOf(map: PhysicalField): Ground {
  let ground = grounds.get(map);
  if (!ground) grounds.set(map, (ground = new Ground(map)));
  return ground;
}
