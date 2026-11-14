import type { GenerationState } from "../process";
import { respond } from "../coupling/answers";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import type { LocateContext, SupplyContext } from "./magicSources";
import { siteStrength } from "./magicStocks";
import { clamp } from "./math";
import { groundOf } from "../rock/ground";
import { surfaceResistance } from "../rock/groundQueries";
import { averageGroundQuery, groundFact } from "../rock/groundQuery";
import { secondsPerYear } from "./dimensions";

/**
 * Greenwood's stands: old growth (a canopy past the stand age with cover past the floor) and
 * deep peat. Both are living matter that has had time; the strength rises with age and depth.
 * Sap that herds and people carried to a cell is a grove in the making: planted sap per area
 * counts toward a full grove's strength, so a herd road or a market at the end of a Deepwood
 * road becomes a source of its own. A stand refills its sap; the strategy keeps the stock.
 */
export function verdantSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  context: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    sap = field.stocks[`${context.origin.id}/sap`];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0 || map.IceThickness.get(i) > 0) continue;
    const canopy = map.BroadleafCover.get(i) + map.ConiferCover.get(i),
      age = map.CanopyAge.get(i),
      peat = map.PeatCarbon.get(i),
      area = map.mesh.area(i);
    let strength = 0;
    if (canopy >= p.standCover && age >= p.standAge)
      strength = 500 + 300 * clamp((age - p.standAge) / Math.max(1, p.standAge), 0, 1);
    if (peat >= p.peatDepth)
      strength = Math.max(
        strength,
        400 + 300 * clamp(peat / Math.max(1e-9, p.peatDepth) - 1, 0, 1)
      );
    strength *= context.activity;
    if (sap && livingStand(canopy, age, p.standCover)) {
      const grove = clamp(sap.get(i) / area / p.groveSap, 0, 1);
      strength = Math.max(strength, 500 * grove);
    }
    const site = siteStrength(strength);
    if (site === 0) continue;
    field.source.set(i, site);
  }
}
const livingStand = (cover: number, age: number, floor: number) => cover >= floor && age > 0;
/** Only established vegetation renews sap. Carried sap cannot refill itself. */
export function supplySap(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin, activity }: SupplyContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    sap = field.stocks[`${origin.id}/sap`];
  if (!sap || activity <= 0) return;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0 || map.IceThickness.get(i) > 0) continue;
    const canopy = map.BroadleafCover.get(i) + map.ConiferCover.get(i),
      mature = canopy >= p.standCover && map.CanopyAge.get(i) >= p.standAge,
      peat = map.PeatCarbon.get(i) >= p.peatDepth;
    if (mature || peat) sap.add(i, activity * map.mesh.area(i) * 500 * p.sapLoss);
  }
}
/**
 * Forge cores: the cracked stock people's trade left at their forges is a source where it
 * lies, at full strength once the cracked cores per area reach the declared amount. Cores
 * carried along the roads between forges are stock in transit, not a source.
 */
export function forgeSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    cracked = field.stocks[`${origin.id}/cracked`];
  if (!cracked) return;
  for (let i = 0; i < map.mesh.count; i++) {
    const held = cracked.get(i);
    if (held <= 0) continue;
    const area = map.mesh.area(i),
      strength = siteStrength((1000 * held) / area / p.forgeStrength);
    if (strength === 0) continue;
    field.source.set(i, strength);
    field.located.push({
      origin: origin.id,
      id: `forge:${i}`,
      x: map.mesh.x(i),
      y: map.mesh.y(i),
      radius: Math.sqrt(area),
      strength,
    });
  }
}
/** Groundwater emergence supplies its own discharge, independently of an existing river. */
function springGround(map: PhysicalField, i: number, springRock: number) {
  if (map.WaterKindCodes.get(i) !== 0 || map.IceThickness.get(i) > 0) return false;
  if (groundOf(map).fold(i, surfaceResistance) > springRock) return false;
  return map.GroundwaterReturn.get(i) > 0 && karst(map, i) >= 0.35;
}
/** Water concentration and actual discharge determine response; site naming has its own floor. */
export function springResponse(
  charge: number,
  waterVolume: number,
  discharge: number,
  concentrationScale: number,
  dischargeScale: number
) {
  if (charge <= 0 || waterVolume <= 0 || discharge <= 0) return 0;
  const concentration = charge / waterVolume;
  return 1000 / (1 + concentrationScale / concentration) / (1 + dischargeScale / discharge);
}
const waterEntry = averageGroundQuery({
  start: 0,
  rock: (_, layer) => Math.max(groundFact(layer, "solubility"), groundFact(layer, "porosity")),
});
/** Current hydraulic material decides entry; earlier volcanism cannot veto replacement sediment. */
export const springSubstrate = (continentalShare: number, entry: number) =>
  continentalShare * (0.3 + 0.7 * entry);
/** Water finds its way through continental crust as far as the present rock allows. */
function karst(map: PhysicalField, i: number) {
  return springSubstrate(
    map.CrustContinentalFraction.get(i) / 1000,
    groundOf(map).fold(i, waterEntry)
  );
}
// What Greenwood's springs feed keeps wet the ground its verdure reaches, so rivers, slopes and soil
// all feel it without knowing it is Greenwood's.
respond({
  key: "wetness",
  by: "greenwood",
  reads: ["Verdure"],
  add: (map, i) => map.Verdure.get(i) * 0.5,
});
/**
 * Greenwood's springs: dissolved charge returns with groundwater through soft, soluble rock.
 * The water and retained charge determine emergence, even away from existing surface drainage.
 * A spring whose karst has fallen in (sealed) rises no more.
 */
export function aquiferSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    aquifer = field.stocks[`${origin.id}/springwater`];
  if (!aquifer) return;
  for (let i = 0; i < map.mesh.count; i++) {
    if (field.sealed.get(i) > 0 || !springGround(map, i, p.springRock)) continue;
    const area = map.mesh.area(i),
      volume = map.GroundwaterReturn.get(i) * area,
      strength = springResponse(
        aquifer.get(i),
        volume,
        volume / secondsPerYear,
        p.springChargeSaturation,
        p.springFlow
      );
    if (strength <= 0) continue;
    field.source.set(i, strength);
    if (siteStrength(strength) === 0) continue;
    field.located.push({
      origin: origin.id,
      id: `spring:${i}`,
      x: map.mesh.x(i),
      y: map.mesh.y(i),
      radius: Math.sqrt(area),
      strength,
    });
  }
}
