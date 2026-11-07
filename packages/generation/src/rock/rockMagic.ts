import type { GenerationState } from "../process";
import { type PhysicalField } from "../world/field";
import { reservoirAmount, type MagicField } from "../world/magicState";
import { units } from "../world/math";
import { rebuild } from "../world/surface";
import { erode, raiseRock } from "./groundLedger";
import { fractalNoise, hashUnit } from "../world/noise";
import {
  hardnessOf,
  rockCatalogue,
  rockKindOfCode,
  type RockKind,
  type RockKindId,
} from "./rockCatalogue";
import { alterTop, changeLayer, layDownRock, layerKind, shuffleLayers } from "./rockColumn";

/**
 * What each system does to the rock, once per epoch, as a physical process of its own: not a
 * resistance added to a sum, but rock made or changed in the column, which then wears, buries and
 * carries like any other. What it makes shows on the map only as far as the processes that follow
 * leave it exposed. Rates are metres per epoch and intensities the field's own scale.
 */
/** Rock that stands proud of its surroundings by what it has made: real height and a layer. */
function addRock(map: PhysicalField, cell: number, kind: RockKindId, metres: number) {
  const amount = units(metres);
  if (amount <= 0) return;
  raiseRock(map, cell, amount, "magic rock", "space");
  layDownRock(map, cell, rockCatalogue[kind], amount);
  rebuild(map, cell);
}
const onLand = (map: PhysicalField, cell: number) => map.WaterKindCodes.get(cell) === 0;
/** A ward holds the rock under it: nothing below alters kept ground. */
const kept = (map: PhysicalField, cell: number) => map.Warding.get(cell) >= wardHolds;

/** The share of ward at which it holds the ground unchanged. */
const wardHolds = 0.3;

/** How wide a body of one system's rock runs, in metres, and how much noise spreads about its middle. */
const bodyScale = 240_000,
  bodySpread = 0.2;
/** Where a point falls among all the map's ground, in [0, 1], in patches that hold together. */
export function bodyRank(x: number, y: number, salt: number) {
  return 1 / (1 + Math.exp(-fractalNoise(x, y, salt, bodyScale, 2) / bodySpread));
}
/**
 * A system covers a share of the ground, and on a coarse map that share is the share of cells that
 * are its rock. The cells are the ones ranked lowest in a patchy field, so its rock forms bodies, and
 * the same ones on every pass, so they build; a roll for each cell alone would only make static.
 */
function inBody(map: PhysicalField, cell: number, share: number, salt: number) {
  const x = map.mesh.origin[0] + map.mesh.x(cell),
    y = map.mesh.origin[1] + map.mesh.y(cell);
  return bodyRank(x, y, salt) < share;
}
const systemSalt = (field: MagicField, seed: number) =>
  seed ^ 0x7e20 ^ field.definition.id.length ^ (field.definition.id.charCodeAt(0) << 8);
const reaches = (map: PhysicalField, field: MagicField, cell: number, seed: number) =>
  inBody(map, cell, field.systemCoverage.get(cell), systemSalt(field, seed));
/** Fire hardens the stone a vein runs through; a spent conduit seals; a fallen core throws debris. */
const veinFrom = 450,
  veinSurfacesFrom = 750,
  sinterMetres = 120,
  corefallMetres = 60,
  coreFrom = 500;
function fireInRock(
  map: PhysicalField,
  field: MagicField,
  cell: number,
  seed: number,
  span: number
) {
  // A sealed conduit is a place, not a share of the ground: it sinters wherever it is.
  if (field.sealed.get(cell) > 0 && layerKind(map, cell, 0) !== rockCatalogue.sinter.code)
    addRock(map, cell, "sinter", sinterMetres * span);
  if (!reaches(map, field, cell, seed)) return;
  const heat = field.intensity.get(cell);
  if (heat >= veinFrom && map.FractureConductance.get(cell) > 0) {
    changeLayer(map, cell, 1, rockCatalogue.veinrock);
    if (heat >= veinSurfacesFrom) changeLayer(map, cell, 0, rockCatalogue.veinrock);
  }
  const fallen = field.originSources.fallen?.get(cell) ?? 0;
  if (fallen >= coreFrom) addRock(map, cell, "corefall", (corefallMetres * span * fallen) / 1000);
}
/** Aurora rots rock open to the sky, ice shields what it covers, and charge grows crystal in it. */
const rotFrom = 250,
  rotMetres = 260,
  rotOdds = 0.25,
  crystalFrom = 350,
  crystalMetres = 150;
function auroraInRock(map: PhysicalField, field: MagicField, cell: number, seed: number) {
  const charge = field.stored.get(cell),
    iced = map.IceThickness.get(cell) > 0;
  // Crystal grows on the bed under charged ice, and is what the ice leaves when it goes.
  if (
    iced &&
    field.source.get(cell) >= crystalFrom &&
    layerKind(map, cell, 0) !== rockCatalogue.auroraCrystal.code
  )
    alterTop(map, cell, rockCatalogue.auroraCrystal, units(crystalMetres));
  if (iced || charge < rotFrom || !onLand(map, cell)) return;
  // Charge left in open ground is what Aurora has there: its share of the ground rots.
  if (inBody(map, cell, (charge / 1000) * rotOdds, systemSalt(field, seed) ^ 0x7e13))
    alterTop(map, cell, rockCatalogue.rimerot, units((rotMetres * charge) / 1000));
}
/** Pressure's rays crush the sea floor and shore they strike, and the sea then cuts what it broke. */
const crushFrom = 300,
  crushMetres = 180;
function pressureInRock(map: PhysicalField, field: MagicField, cell: number, seed: number) {
  const force = field.intensity.get(cell);
  if (force < crushFrom || !reaches(map, field, cell, seed)) return;
  if (onLand(map, cell) && map.ExternalCoastalForcing.get(cell) <= 0) return;
  alterTop(map, cell, rockCatalogue.crushstone, units((crushMetres * force) / 1000));
}
/** Greenwood's roots open the top of the rock, its springs lay tufa, its water takes soluble rock. */
const rootFrom = 350,
  rootMetres = 70,
  springFrom = 300,
  tufaMetres = 18,
  dissolveFrom = 200,
  dissolveMetres = 120;
function greenwoodInRock(
  map: PhysicalField,
  field: MagicField,
  cell: number,
  seed: number,
  span: number
) {
  if (!onLand(map, cell) || !reaches(map, field, cell, seed)) return;
  const growth = field.intensity.get(cell),
    solubility = rockKindOfCode(layerKind(map, cell, 0)).solubility,
    above = Math.max(0, map.Elevation.get(cell) - map.EffectiveSeaLevel);
  // What water dissolves goes down to where the water does, and no further.
  if (growth >= dissolveFrom && solubility > 0)
    erode(
      map,
      cell,
      Math.min(above, units((dissolveMetres * span * solubility * growth) / 1000)),
      "greenwood"
    );
  if (growth >= rootFrom)
    alterTop(map, cell, rockCatalogue.rootstone, units((rootMetres * growth) / 1000));
  if ((field.originSources.spring?.get(cell) ?? 0) >= springFrom)
    addRock(map, cell, "tufa", tufaMetres * span);
}
/** Salt held in a basin is a real bed in the column: it can be buried, and uncovered again. */
const bedFrom = 0.2,
  bedMetres = 80;
function saltInRock(map: PhysicalField, field: MagicField, cell: number, seed: number) {
  if (!onLand(map, cell) || !reaches(map, field, cell, seed)) return;
  const full = field.definition.parameters.saltFull,
    share = reservoirAmount(field, "bed", cell) / (map.mesh.area(cell) * full),
    top = layerKind(map, cell, 0);
  // The stock is the salt's amount; the layer only says where it lies, and adds no ground of its own.
  if (
    share >= bedFrom &&
    top !== rockCatalogue.saltGlass.code &&
    top !== rockCatalogue.saltbed.code
  )
    alterTop(map, cell, rockCatalogue.saltbed, units(bedMetres * Math.min(1, share)));
}
/** Veil shuffles the column under a tear: the only thing that puts layers out of their order. */
const shuffleFrom = 0.25,
  tornMetres = 90;
function veilInRock(map: PhysicalField, field: MagicField, cell: number, seed: number) {
  const wild = field.wild.get(cell);
  if (wild < shuffleFrom || !reaches(map, field, cell, seed)) return;
  shuffleLayers(map, cell, hashUnit(seed ^ 0x7e12, cell, 0));
  alterTop(map, cell, rockCatalogue.tornstone, units(tornMetres * wild));
}
/** How thick the ground a ward holds is: enough to stand while the land around it wears. */
const keptMetres = 300;
/** Hallowed keeps the ground it wards as it is, and it stands while the land around it wears. */
function hallowedInRock(map: PhysicalField, cell: number) {
  if (onLand(map, cell) && layerKind(map, cell, 0) !== rockCatalogue.keptStone.code)
    alterTop(map, cell, rockCatalogue.keptStone, units(keptMetres));
}
/**
 * Each system's stock lies in rock, and how the rock is built decides how much of it stays there on
 * a pass. What leaves is lost to the system. These are what the rock's own properties say, so the
 * same rock holds or spills each system differently, and it changes as the column does.
 */
const stockLeak = 0.12;
const leaks: Readonly<Record<string, (rock: RockKind) => number>> = {
  // Fire held in a vein gets out through open joints.
  held: (rock) => rock.jointing,
  // Aurora's charge in the ground drains out of porous rock.
  ground: (rock) => rock.porosity,
  // An aquifer holds in porous rock and is lost from tight rock.
  aquifer: (rock) => 1 - rock.porosity,
  // Roots' buried stratum dissolves away with the rock it lies in.
  stratum: (rock) => rock.solubility,
};
/** The share of a stock that leaks from a rock on a pass. */
export const stockLeakIn = (reservoir: string, rock: RockKind) =>
  stockLeak * (leaks[reservoir]?.(rock) ?? 0);
/**
 * Hallowed holds its charge where the rock is hard, and Veil's tears stay open where it is broken,
 * so those two read the opposite way from a vein in the same reservoir.
 */
const heldFor: Readonly<Record<string, (rock: RockKind) => number>> = {
  hallowed: (rock) => 1 - hardnessOf(rock.resistance),
  veil: (rock) => 1 - rock.jointing,
};
export const heldLeakIn = (system: string, rock: RockKind) =>
  stockLeak * (heldFor[system]?.(rock) ?? rock.jointing);
function leakFromColumn(map: PhysicalField, field: MagicField, cell: number) {
  const rock = rockKindOfCode(layerKind(map, cell, 0));
  for (const [key, stock] of Object.entries(field.stocks)) {
    const reservoir = key.slice(key.lastIndexOf("/") + 1),
      share =
        reservoir === "held" ? heldLeakIn(field.definition.id, rock) : stockLeakIn(reservoir, rock),
      held = stock.get(cell);
    if (share <= 0 || held <= 0) continue;
    stock.set(cell, held * (1 - share));
    field.lost += held * share;
  }
}
const systemsOf = (state: GenerationState) => {
  const fields = state.physical!.magic!.fields.filter((field) => field.definition.enabled),
    having = (effect: "conduitOpening" | "stillness" | "coastalForcing" | "verdure" | "salting") =>
      fields.filter((field) => (field.definition.effects[effect] ?? 0) !== 0),
    tearing = fields.filter((field) => (field.definition.effects.tearing ?? 0) !== 0);
  return {
    fire: having("conduitOpening"),
    aurora: having("stillness"),
    pressure: having("coastalForcing"),
    greenwood: having("verdure"),
    salt: having("salting"),
    tearing,
  };
};
/** Once per epoch, after the systems and their meetings have acted on the ground. */
export function magicOnTheColumn(state: GenerationState, seed: number, span: number) {
  const map = state.physical!.map,
    systems = systemsOf(state),
    leaking = state.physical!.magic!.fields.filter(
      (field) => field.definition.enabled && (field.definition.effects.salting ?? 0) === 0
    );
  for (let cell = 0; cell < map.mesh.count; cell++) {
    for (const field of leaking) leakFromColumn(map, field, cell);
    if (kept(map, cell)) {
      hallowedInRock(map, cell);
      continue;
    }
    for (const field of systems.fire) fireInRock(map, field, cell, seed, span);
    for (const field of systems.aurora) auroraInRock(map, field, cell, seed);
    for (const field of systems.pressure) pressureInRock(map, field, cell, seed);
    for (const field of systems.greenwood) greenwoodInRock(map, field, cell, seed, span);
    for (const field of systems.salt) saltInRock(map, field, cell, seed);
    for (const field of systems.tearing) veilInRock(map, field, cell, seed);
  }
}
/** What each meeting between systems makes of the rock it covers, and how much. */
const meetingRock: Readonly<Record<string, RockKindId>> = {
  steam: "sinter",
  breach: "crushstone",
  rot: "rootstone",
  frozen: "rimerot",
  brackish: "tufa",
  fired: "saltGlass",
  war: "tornstone",
  "brine-shore": "saltbed",
};
const meetingMetres = 140;
/** A meeting's coverage is the share of the cell it has changed, not a change to the whole of it. */
export function meetingInRock(
  map: PhysicalField,
  id: string,
  cell: number,
  coverage: number,
  salt: number
) {
  const made = meetingRock[id];
  if (!made || kept(map, cell) || !inBody(map, cell, coverage, salt)) return;
  alterTop(map, cell, rockCatalogue[made], units(meetingMetres));
}
