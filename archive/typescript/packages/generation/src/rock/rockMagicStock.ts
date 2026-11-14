import { groundOf } from "./ground";
import { materialFact } from "./groundQuery";
import { sectionExposure, sectionInventory, sectionResponse } from "./groundQueries";
import { hardnessOf, rockCatalogue, type RockKind } from "./rockCatalogue";
import type { GroundSectionLayer } from "./groundShares";
import type { PhysicalField } from "../world/field";
import { originStocks, stockKey, unscopedDefinition, type MagicField } from "../world/magicState";
import { units } from "../world/math";
import { requireThat, type MagicOrigin } from "@atlas/domain";
import { removeLoose } from "./groundLedger";
import { extractableDepth, type GroundExtraction } from "./groundExtraction";
import type { MaterialLayer } from "./rockColumn";
import type { MaterialReceiver } from "./groundMaterial";
import { GroundInventory } from "./groundInventory";
import type { MagicInventory } from "../world/magicInventory";

/** Convert a finite mineral inventory to native thickness using its material density, not intensity. */
export const mineralStockDepth = (amount: number, area: number, density: number) =>
  units(amount / (area * density));
/** A newly deposited stock makes its material once; retained stock cannot recreate a buried bed. */
export function depositSaltBed(
  map: PhysicalField,
  bed: MagicInventory,
  cell: number,
  amount: number,
  density: number
) {
  if (amount <= 0) return;
  const depth = mineralStockDepth(amount, map.mesh.area(cell), density);
  requireThat(
    bed instanceof GroundInventory,
    "ground_inventory",
    "Solid Salt must belong to Ground."
  );
  bed.construct(cell, amount, depth, rockCatalogue.saltbed.code, "salt");
}

/** Only actual withdrawn Salt can enter a mobile reservoir. Receipts retain the grain history. */
export function withdrawSaltBed(
  bed: MagicInventory,
  cell: number,
  amount: number,
  access: Pick<GroundExtraction, "reach" | "surfaceOnly" | "looseOnly">,
  receive?: MaterialReceiver
) {
  if (amount <= 0) return 0;
  requireThat(
    bed instanceof GroundInventory,
    "ground_inventory",
    "Solid Salt must belong to Ground."
  );
  // Without a solid receiver this operation dissolves the mineral into the caller's fluid sink.
  return bed.extract(cell, Math.min(amount, bed.get(cell)), access, receive ?? (() => {}));
}

/** The compact mineral body is a fraction of the ejecta volume that supplied its core inventory. */
const coreMineralShare = 0.15;
/** Fallen stock arrives with a host even on rock too hard to become impactite. */
export function depositFallenCores(
  map: PhysicalField,
  held: MagicInventory,
  cell: number,
  amount: number,
  density: number
) {
  if (amount <= 0 || density <= 0) return;
  const depth = mineralStockDepth(amount * coreMineralShare, map.mesh.area(cell), density);
  requireThat(
    held instanceof GroundInventory,
    "ground_inventory",
    "Fallen cores must belong to Ground."
  );
  held.construct(cell, amount, depth, rockCatalogue.corefall.code, "fire");
}

/** Both constituents can carry a material's stock, including weathered and transported clasts. */
export function containsHost(layer: GroundSectionLayer, kinds: readonly number[]) {
  return hostFraction(layer, kinds) > 0;
}
const hostFraction = (layer: Readonly<MaterialLayer>, kinds: readonly number[]) =>
  (kinds.includes(layer.kind) ? 1 - layer.secondaryShare : 0) +
  (kinds.includes(layer.secondaryKind) ? layer.secondaryShare : 0);

/** Native host thickness excludes the numerical basement marker, matching actual extraction. */
export function retainedHostDepth(map: PhysicalField, cell: number, kinds: readonly number[]) {
  let depth = 0;
  for (const facet of ["land", "cut"] as const)
    for (const layer of groundOf(map).section(cell, facet))
      depth += extractableDepth(layer, layer.basement) * layer.share * hostFraction(layer, kinds);
  return depth;
}

/** Withdraw actual loose carrier material; intact beds cannot become placers by moving a scalar. */
export function withdrawStockHost(
  map: PhysicalField,
  cell: number,
  kinds: readonly number[],
  fraction: number,
  receive: MaterialReceiver
) {
  const ground = groundOf(map),
    skin = map.SoilDepth.get(cell);
  let available = 0,
    loose = 0,
    moved = 0;
  for (const facet of ["land", "cut"] as const)
    for (const layer of ground.section(cell, facet)) {
      const host = layer.depth * layer.share * hostFraction(layer, kinds);
      available += host;
      if (layer.medium === "loose") loose += host;
    }
  if (loose <= 0 || fraction <= 0) return 0;
  for (const facet of ["land", "cut"] as const)
    removeLoose(
      map,
      cell,
      ground.coverDepth(cell, facet) * Math.min(1, fraction),
      "river placers",
      (material) => {
        moved += material.depth * hostFraction(material, kinds);
        receive(material);
      },
      facet,
      skin
    );
  return available > 0 ? Math.min(1, moved / available) : 0;
}

/** Fraction of retained host material reached through both facets; unhosted stocks use exposed area. */
export function stockExposure(
  map: PhysicalField,
  cell: number,
  buryDepth: number,
  hostKinds?: readonly number[]
) {
  const ground = groundOf(map);
  let available = 0,
    reached = 0;
  for (const facet of ["land", "cut"] as const) {
    const section = ground.section(cell, facet),
      share = ground.share(cell, facet),
      inventory = hostKinds
        ? sectionInventory(section, units(buryDepth), (layer) => hostFraction(layer, hostKinds))
        : { available: 1, reached: sectionExposure(section, units(buryDepth)) };
    available += share * inventory.available;
    reached += share * inventory.reached;
  }
  return available > 0 ? reached / available : 0;
}

/** Fraction of accessible stock dissipated per epoch at full material susceptibility. */
const stockLeak = 0.12;
const leaks: Readonly<Record<string, (rock: RockKind) => number>> = {
  held: (rock) => rock.jointing,
  spent: (rock) => rock.jointing,
  ground: (rock) => rock.porosity,
  aquifer: (rock) => 1 - rock.porosity,
  stratum: (rock) => rock.solubility,
  moraine: (rock) => rock.porosity,
  shelf: (rock) => rock.porosity,
};
export const stockLeakIn = (reservoir: string, rock: RockKind) =>
  stockLeak * (leaks[reservoir]?.(rock) ?? 0);
const heldFor: Readonly<Record<string, (rock: RockKind) => number>> = {
  hallowed: (rock) => 1 - hardnessOf(rock.resistance),
  veil: (rock) => 1 - rock.jointing,
};
export const heldLeakIn = (system: string, rock: RockKind) =>
  stockLeak * (heldFor[system]?.(rock) ?? rock.jointing);

const fireHosts = [
  rockCatalogue.veinrock.code,
  rockCatalogue.sinter.code,
  rockCatalogue.corefall.code,
  rockCatalogue.impactite.code,
];
const auroraHosts = [rockCatalogue.rimerot.code, rockCatalogue.auroraCrystal.code];
const greenwoodHosts = [rockCatalogue.rootstone.code, rockCatalogue.tufa.code];
const materialHosts: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>> = {
  fire: { held: fireHosts, spent: fireHosts },
  aurora: { ground: auroraHosts, moraine: auroraHosts },
  greenwood: { stratum: greenwoodHosts },
  hallowed: { held: [rockCatalogue.keptStone.code] },
  veil: { held: [rockCatalogue.tornstone.code] },
  salt: {
    bed: [rockCatalogue.saltbed.code, rockCatalogue.saltGlass.code],
    dust: [rockCatalogue.saltbed.code, rockCatalogue.saltGlass.code],
  },
};
/** Host identity locates retained alteration; it does not make the cell stock a second rock column. */
export function stockGroundHosts(system: string, reservoir: string) {
  return materialHosts[system]?.[reservoir];
}

/** Origin overrides are already measured at the configuration boundary, like the system default. */
export const originBurialDepth = (field: Pick<MagicField, "definition">, origin: MagicOrigin) =>
  origin.parameters.buryDepth ?? unscopedDefinition(field).parameters.buryDepth;

/** Surface manifestations read accessible stock; the retained amount remains available to deep work. */
export function exposedReservoirAmount(
  map: PhysicalField,
  field: Pick<MagicField, "definition" | "stocks">,
  reservoir: string,
  cell: number
) {
  let amount = 0;
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin)) {
      if (stock.reservoir !== reservoir) continue;
      const values = field.stocks[stockKey(origin, stock)],
        buryDepth = originBurialDepth(field, origin);
      amount +=
        values instanceof GroundInventory
          ? values.reached(cell, units(buryDepth))
          : values.get(cell) * stockAvailability(map, field, reservoir, cell, buryDepth);
    }
  return amount;
}
function stockAvailability(
  map: PhysicalField,
  field: Pick<MagicField, "definition">,
  reservoir: string,
  cell: number,
  buryDepth: number
) {
  const hosts = stockGroundHosts(field.definition.id, reservoir);
  return hosts ? stockExposure(map, cell, buryDepth, hosts) : 1;
}
/** Resolve stock metadata once for a feature query, then read its currently accessible amount. */
export function stockSurfaceReader(
  map: PhysicalField,
  field: Pick<MagicField, "definition" | "stocks">,
  key: string
) {
  const values = field.stocks[key];
  if (!values) return () => 0;
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin))
      if (stockKey(origin, stock) === key) {
        const buryDepth = originBurialDepth(field, origin);
        return values instanceof GroundInventory
          ? (cell: number) => values.reached(cell, units(buryDepth))
          : (cell: number) =>
              values.get(cell) * stockAvailability(map, field, stock.reservoir, cell, buryDepth);
      }
  return () => 0;
}

/** Dissipation reads the reached host and its overburden, not an unrelated surface material. */
export function leakFromColumn(map: PhysicalField, field: MagicField, cell: number) {
  let groundBefore = 0,
    groundAfter = 0;
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin)) {
      const values = field.stocks[stockKey(origin, stock)],
        held = values.get(cell),
        buryDepth = originBurialDepth(field, origin);
      if (held <= 0 || !leaks[stock.reservoir]) continue;
      const lost =
        values instanceof GroundInventory
          ? values.release(cell, units(buryDepth), (layer) =>
              materialLeak(field, stock.reservoir, layer)
            )
          : held * leakage(map, field, cell, stock.reservoir, buryDepth);
      if (!(values instanceof GroundInventory)) values.set(cell, held - lost);
      field.lost += lost;
      if (stock.reservoir === "ground") {
        groundBefore += held;
        groundAfter += held - lost;
      }
    }
  // The ground amount mirrors stored charge; it must not recover dissipated charge next epoch.
  if (groundBefore > 0)
    field.stored.set(cell, field.stored.get(cell) * (groundAfter / groundBefore));
}

function materialLeak(field: MagicField, reservoir: string, layer: MaterialLayer) {
  const rock = {
    ...rockCatalogue.strata,
    resistance: materialFact(layer, "resistance"),
    jointing: materialFact(layer, "jointing"),
    porosity: materialFact(layer, "porosity"),
    solubility: materialFact(layer, "solubility"),
  };
  return reservoir === "held"
    ? heldLeakIn(field.definition.id, rock)
    : stockLeakIn(reservoir, rock);
}
function leakage(
  map: PhysicalField,
  field: MagicField,
  cell: number,
  reservoir: string,
  buryDepth: number
) {
  const ground = groundOf(map),
    reach = units(buryDepth),
    kinds = stockGroundHosts(field.definition.id, reservoir),
    response = (layer: GroundSectionLayer) => materialLeak(field, reservoir, layer);
  let value = 0,
    available = 0,
    fallback = 0;
  for (const facet of ["land", "cut"] as const) {
    const section = ground.section(cell, facet),
      share = ground.share(cell, facet);
    fallback += share * sectionResponse(section, reach, response);
    if (!kinds) continue;
    const inventory = sectionInventory(section, reach, (layer) => hostFraction(layer, kinds)),
      loss = sectionInventory(
        section,
        reach,
        (layer) => hostFraction(layer, kinds) * response(layer)
      );
    available += share * inventory.available;
    value += share * loss.reached;
  }
  return available > 0 ? value / available : fallback;
}
