import type { PhysicalField } from "../canonry/field";
import { clamp, units } from "../canonry/math";
import {
  baselineRock,
  hardestRock,
  hardnessOf,
  rockKindOfCode,
  rockResponse,
  sedimentResistance,
  type RockKind,
} from "./rockCatalogue";

/** The depth of loose sediment that fully covers the rock beneath it, in metres. */
const fullCover = 25;
/** How far each kind of cover and burning changes what streams must cut through. */
const rootHold = { tree: 1.2, grass: 0.45, wetland: 0.7 },
  burntShare = 0.5;
/** How far cover steepens the slope ground holds and binds what it can shed. */
const slopeHold = { tree: 0.2, grass: 0.1 },
  slopeBinding = { grass: 0.5, wetland: 0.5, share: 0.6 };
/** How far open fractures weaken ground and a ward strengthens it, and the bounds of the result. */
const fractureWeight = 0.5,
  wardStrength = 0.5,
  weakestMaterial = 0.35,
  strongestMaterial = 3.5;
const grounds = new WeakMap<PhysicalField, Ground>();

/**
 * What the ground at a cell is and how it answers what works on it: the rock the catalogue
 * describes, as altered and covered on this map. Everything outside the rock module reads rock
 * here, on world and region alike, so a process never decides for itself what hard means.
 */
export class Ground {
  constructor(private readonly map: PhysicalField) {}
  /** The kind of rock at the surface. */
  kind(i: number): RockKind {
    return rockKindOfCode(this.map.RockKindCodes.get(i));
  }
  /** Its resistance as altered here, on the catalogue's scale. */
  resistance(i: number) {
    return this.map.RockResistance.get(i);
  }
  /** Its resistance against ordinary rock. */
  relative(i: number) {
    return this.resistance(i) / baselineRock;
  }
  /** Its resistance as a share of the hardest rock there is. */
  shareOfHardest(i: number) {
    return this.resistance(i) / hardestRock;
  }
  /** How hard it is for anything judging its character, in [0, 1]. */
  hardness(i: number) {
    return hardnessOf(this.resistance(i));
  }
  /** How broken it is: its rock's joints, or the fractures that crossed it. */
  openness(i: number) {
    return Math.max(this.kind(i).jointing, Math.min(1, this.map.FractureConductance.get(i) / 1000));
  }
  /** What a stream must cut through: the rock, under what covers it and what its roots bind. */
  surface(i: number) {
    const map = this.map,
      cover = clamp(map.SedimentThickness.get(i) / units(fullCover), 0, 1),
      rock = Math.max(1, map.RockResistance.get(i));
    // Burnt ground has lost its binding roots for the season: it gullies.
    const roots =
      (1 +
        map.TreeCover.get(i) * rootHold.tree +
        map.GrassCover.get(i) * rootHold.grass +
        map.WetlandCover.get(i) * rootHold.wetland) *
      (1 - burntShare * map.FireActivity.get(i));
    return Math.max(1, (rock + (sedimentResistance - rock) * cover) * roots);
  }
  /** How much of what a stream could move this ground gives up. */
  streamTakes(i: number, moved: number) {
    return (moved * baselineRock) / this.surface(i);
  }
  /** The share of a cell a stream's reach lowers: weak ground lets it widen, strong keeps it narrow. */
  streamWidens(i: number, reach: number) {
    return Math.min(1, (reach * baselineRock) / this.surface(i));
  }
  /** How much of what ice could move this ground gives up. */
  iceTakes(i: number, moved: number) {
    return rockResponse.iceTakes(moved, this.resistance(i));
  }
  /** How far the rock's strength steepens the slope it holds. */
  slopeFirmness(i: number) {
    return rockResponse.slopeFirmness(this.resistance(i));
  }
  /** How far the rock's joints lower the slope it holds. */
  slopeJoints(i: number) {
    return rockResponse.slopeJoints(this.kind(i));
  }
  /** How far living cover steepens the slope ground holds. */
  slopeCover(i: number) {
    return (
      1 + this.map.TreeCover.get(i) * slopeHold.tree + this.map.GrassCover.get(i) * slopeHold.grass
    );
  }
  /** The share of what a slope could shed that living cover leaves free. */
  slopeUnbound(i: number) {
    const map = this.map,
      bound = clamp(
        map.TreeCover.get(i) +
          slopeBinding.grass * map.GrassCover.get(i) +
          slopeBinding.wetland * map.WetlandCover.get(i),
        0,
        1
      );
    return 1 - slopeBinding.share * bound;
  }
  /** How far the rock's strength holds back what a failing slope sheds. */
  slopeShedding(i: number) {
    return rockResponse.slopeShedding(this.resistance(i));
  }
  /** How far the rock's stiffness spaces a belt's thrust sheets. */
  sheetStiffness(i: number) {
    return rockResponse.sheetStiffness(this.resistance(i));
  }
  /** How far the rock's strength sharpens the fine relief it carries. */
  reliefDetail(i: number) {
    return rockResponse.reliefDetail(this.resistance(i));
  }
  /** How far a channel's banks hold it narrow and deep. */
  channelBank(i: number) {
    return rockResponse.channelBank(this.resistance(i));
  }
  /** How far the rock holds back water leaking through it. */
  seepageHold(i: number) {
    return rockResponse.seepageHold(this.resistance(i));
  }
  /**
   * What water, rock and Fire meet in cutting this ground: exposed rock and intact ground resist,
   * open fractures yield, a ward holds its beds and banks. `hardened` is anything else stiffening it.
   */
  material(i: number, hardened = 1) {
    const map = this.map,
      fracture = clamp(map.FractureConductance.get(i) / 1000, 0, 1),
      ward = clamp(map.Warding.get(i), 0, 1);
    return clamp(
      rockResponse.material(this.resistance(i)) *
        Math.exp(-fractureWeight * fracture) *
        (1 + wardStrength * ward) *
        hardened,
      weakestMaterial,
      strongestMaterial
    );
  }
}
/** The ground of a map. */
export function groundOf(map: PhysicalField): Ground {
  let ground = grounds.get(map);
  if (!ground) grounds.set(map, (ground = new Ground(map)));
  return ground;
}
