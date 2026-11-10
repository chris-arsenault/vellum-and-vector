import type { ReadBand } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { TransportPlan } from "../world/transportPlan";
import {
  coarsenPackage,
  columnSize,
  observeRemapPackage,
  setLayer,
  type MaterialLayer,
} from "./rockColumn";
import { columnFields, materialProperties, type Column } from "./rockLayerFields";
import { facetSurface, projectGround, type GroundFacet } from "./groundShares";
import { groundStorage } from "./groundStorage";
import type { Deformation } from "./groundTransform";
import {
  groundPlacementFields,
  groundSheetFields,
  heldPlacement,
  heldProperty,
  placeCarriedGround,
  type HeldRock,
} from "./groundTransport";
import { observeRemap } from "./groundTransferObservation";
import { MaterialMixture } from "./materialMixture";
import { RemapSource } from "./groundRemapSource";
import { sameCargo } from "./materialCargo";
import { readCargo, writeCargo } from "./groundCargo";

/** Target-indexed surviving physical overlap. Weights share the target's area unit. */
export interface GroundArrivals {
  offsets: ReadBand;
  sources: ReadBand;
  weights: ReadBand;
}
interface Arrival {
  source: number;
  weight: number;
  cut: number;
  deformation: Deformation;
}
/** Bounded transient donor sections, never another retained terrain representation. */
interface Section {
  weight: number;
  top: number;
  layers: MaterialLayer[];
}
const transform = (plan: TransportPlan, source: number): Deformation => [
  plan.deformationXX.get(source),
  plan.deformationXY.get(source),
  plan.deformationYX.get(source),
  plan.deformationYY.get(source),
];
function incoming(held: HeldRock, cell: number, arrivals: GroundArrivals, plan: TransportPlan) {
  const donors: Arrival[] = [];
  let area = 0;
  for (let k = arrivals.offsets.get(cell); k < arrivals.offsets.get(cell + 1); k++) {
    const weight = arrivals.weights.get(k),
      source = arrivals.sources.get(k);
    if (weight <= 0) continue;
    donors.push({
      source,
      weight,
      cut: heldProperty(held, "GroundCutShare", source),
      deformation: transform(plan, source),
    });
    area += weight;
  }
  for (const donor of donors) donor.weight /= area;
  return donors;
}
const share = (donor: Arrival, column: Column) =>
  column === "cut" || column === "cutLoose" ? donor.cut : 1 - donor.cut;
const rockHeight = (held: HeldRock, donor: Arrival, cut: boolean) =>
  heldPlacement(held, "BedrockElevation", donor.source) +
  (donor.cut - (cut ? 1 : 0)) * heldProperty(held, "GroundCutDepth", donor.source);
function sections(
  held: HeldRock,
  source: RemapSource,
  donors: Arrival[],
  column: Column
): Section[] {
  let area = 0;
  const result: Section[] = [];
  for (const donor of donors) {
    const weight = donor.weight * share(donor, column);
    if (weight <= 0) continue;
    const cover = column === "loose" || column === "cutLoose",
      layers = finiteCargoBasement(source.layers(donor.source, column), cover),
      top =
        rockHeight(held, donor, column === "cut" || column === "cutLoose") +
        (cover ? layers.reduce((depth, layer) => depth + layer.depth, 0) : 0);
    result.push({
      weight,
      top,
      layers,
    });
    area += weight;
  }
  for (const section of result) section.weight /= area;
  return result;
}
/** A retained charged prefix ends before the unbounded ordinary basement begins. */
function finiteCargoBasement(layers: MaterialLayer[], finite: boolean) {
  const last = layers.at(-1);
  if (finite || !last?.cargo) return layers;
  const result = layers.slice(0, -1);
  if (last.depth > 1) result.push({ ...last, depth: last.depth - 1 });
  result.push({ ...last, depth: 1, cargo: undefined });
  return result;
}
function nextContact(
  sections: Section[],
  indices: Uint8Array,
  tops: Float64Array,
  bottoms: Float64Array,
  finite: boolean,
  above: number
) {
  let next = Infinity;
  for (let i = 0; i < sections.length; i++) {
    const last = sections[i].layers.length - (finite ? 0 : 1);
    if (above < tops[i]) next = Math.min(next, tops[i]);
    else if (indices[i] < last) next = Math.min(next, bottoms[i]);
  }
  return next;
}
function slab(
  mixture: MaterialMixture,
  sections: Section[],
  indices: Uint8Array,
  tops: Float64Array,
  above: number,
  thickness: number
) {
  mixture.reset();
  let occupied = 0,
    marker = 0;
  for (let i = 0; i < sections.length; i++) {
    const { layers, weight } = sections[i],
      layer = layers[indices[i]];
    if (!layer || above < tops[i]) continue;
    mixture.add(layer, weight);
    occupied += weight;
    marker += weight * layer.depth;
  }
  return mixture.material(thickness === Infinity ? marker / occupied : thickness * occupied);
}
function append(layers: MaterialLayer[], layer: MaterialLayer) {
  const previous = layers.at(-1);
  if (
    previous &&
    sameCargo(previous.cargo, layer.cargo) &&
    materialProperties.every(
      (property) => property === "depth" || previous[property] === layer[property]
    )
  )
    layers[layers.length - 1] = { ...previous, depth: previous.depth + layer.depth };
  else layers.push(layer);
}
function advance(
  sections: Section[],
  indices: Uint8Array,
  bottoms: Float64Array,
  next: number,
  finite: boolean
) {
  for (let i = 0; i < sections.length; i++)
    if (indices[i] < sections[i].layers.length - (finite ? 0 : 1) && bottoms[i] <= next) {
      indices[i]++;
      bottoms[i] += sections[i].layers[indices[i]]?.depth ?? Infinity;
    }
}
/**
 * Actual contact altitudes share one vertical datum, without guessing stratigraphic identities.
 * Space above each donor and empty finite cover contribute absence, removed from each slab.
 * Solid basements continue beneath their last finite contact. Lateral arrivals never stack.
 */
function sweep(sections: Section[], finite: boolean, mixture: MaterialMixture) {
  const highest = sections.reduce((height, section) => Math.max(height, section.top), -Infinity),
    indices = new Uint8Array(sections.length),
    tops = Float64Array.from(sections, (section) => highest - section.top),
    bottoms = Float64Array.from(
      sections,
      (section, i) => tops[i] + (section.layers[0]?.depth ?? Infinity)
    ),
    layers: MaterialLayer[] = [];
  let above = 0;
  for (;;) {
    const next = nextContact(sections, indices, tops, bottoms, finite, above),
      layer = slab(mixture, sections, indices, tops, above, next - above);
    if (layer && (next < Infinity || !finite)) {
      if (next < Infinity) append(layers, layer);
      else layers.push(layer); // The unbounded basement remains distinct from the finite beds.
    }
    if (next === Infinity) break;
    advance(sections, indices, bottoms, next, finite);
    above = next;
  }
  return layers;
}
function install(
  map: PhysicalField,
  held: HeldRock,
  source: RemapSource,
  mixture: MaterialMixture,
  cell: number,
  donors: Arrival[],
  column: Column
) {
  const finite = column === "loose" || column === "cutLoose",
    layers = sweep(sections(held, source, donors, column), finite, mixture),
    initial = layers.length;
  coarsenPackage(layers, cell, column);
  observeRemapPackage(column, initial, layers.length);
  for (let slot = 0; slot < columnSize(column); slot++) {
    const layer = layers[slot];
    if (layer) setLayer(map, cell, slot, layer.kind, layer.depth, layer, column);
    else setLayer(map, cell, slot, 0, 0, {}, column);
  }
}
function facetHeight(held: HeldRock, donors: Arrival[], facet: GroundFacet) {
  let height = 0,
    area = 0;
  for (const donor of donors) {
    const weight = donor.weight * share(donor, facet),
      surface = rockHeight(held, donor, facet === "cut");
    height += surface * weight;
    area += weight;
  }
  return area > 0 ? height / area : 0;
}
function place(map: PhysicalField, held: HeldRock, cell: number, donors: Arrival[]) {
  const stored = groundStorage(map),
    cut = donors.reduce((total, donor) => total + donor.weight * donor.cut, 0),
    landHeight = facetHeight(held, donors, "land"),
    cutHeight = facetHeight(held, donors, "cut");
  for (const name of groundPlacementFields)
    stored[name].set(
      cell,
      donors.reduce((sum, donor) => sum + donor.weight * heldPlacement(held, name, donor.source), 0)
    );
  stored.GroundCutShare.set(cell, cut);
  // Conditional populations can reverse their relative heights; do not clamp that information.
  stored.GroundCutDepth.set(cell, cut > 0 && cut < 1 ? landHeight - cutHeight : 0);
  stored.BedrockElevation.set(cell, landHeight * (1 - cut) + cutHeight * cut);
  const dominant = donors.reduce((best, donor) => (donor.weight > best.weight ? donor : best));
  for (let n = 0; n < groundSheetFields.length; n++)
    stored[groundSheetFields[n]].set(cell, held.kinds[n].get(dominant.source));
  for (const name of ["CrustSuturePairIds", "CrustSutureStrength", "CrustProvinceSeam"] as const)
    stored[name].set(cell, heldProperty(held, name, dominant.source));
}
/** The cut names the lower complete surface, including cover, after lateral reconstruction. */
function orderFacets(map: PhysicalField, cell: number) {
  const stored = groundStorage(map),
    cut = map.GroundCutShare.get(cell);
  if (cut <= 0 || cut >= 1 || facetSurface(map, cell, "land") >= facetSurface(map, cell, "cut"))
    return;
  for (const [land, valley] of [
    ["land", "cut"],
    ["loose", "cutLoose"],
  ] as const) {
    for (let slot = 0; slot < columnSize(land); slot++) {
      const a = readCargo(map, cell, slot, land),
        b = readCargo(map, cell, slot, valley);
      writeCargo(map, cell, slot, land, b);
      writeCargo(map, cell, slot, valley, a);
    }
    for (const property of materialProperties)
      for (let slot = 0; slot < columnSize(land); slot++) {
        const a = stored[columnFields[land][property][slot]],
          b = stored[columnFields[valley][property][slot]],
          value = a.get(cell);
        a.set(cell, b.get(cell));
        b.set(cell, value);
      }
  }
  stored.GroundCutShare.set(cell, 1 - cut);
  stored.GroundCutDepth.set(cell, -map.GroundCutDepth.get(cell));
}
function orderedDonor(held: HeldRock, donor: Arrival) {
  if (donor.cut <= 0 || donor.cut >= 1) return true;
  const cover = (column: Column) =>
    columnFields[column].depth.reduce(
      (depth, name) => depth + heldProperty(held, name, donor.source),
      0
    );
  return (
    rockHeight(held, donor, false) + cover("loose") >=
    rockHeight(held, donor, true) + cover("cutLoose")
  );
}
/** Reconstruct placement and every material interval from the same retained areas, then publish once. */
export class GroundRemapper {
  private readonly source;
  private readonly mixture = new MaterialMixture();
  constructor(
    private readonly map: PhysicalField,
    private readonly held: HeldRock,
    private readonly plan: TransportPlan
  ) {
    this.source = new RemapSource(map, held, plan);
  }
  place(cell: number, arrivals: GroundArrivals) {
    const { map, held, plan } = this,
      donors = incoming(held, cell, arrivals, plan);
    if (donors.length === 0) return;
    if (donors.length === 1 && orderedDonor(held, donors[0])) {
      placeCarriedGround(map, held, cell, donors[0].source, donors[0].deformation);
      return;
    }
    const observed = observeRemap(map, held, cell, donors);
    for (const column of ["land", "cut", "loose", "cutLoose"] as const)
      install(map, held, this.source, this.mixture, cell, donors, column);
    place(map, held, cell, donors);
    orderFacets(map, cell);
    projectGround(map, cell);
    observed();
  }
  close() {
    this.source.close();
  }
}
