import type { GenerationState } from "../process";
import { type PhysicalField } from "../world/field";
import { type MagicField } from "../world/magicState";
import { clamp, units } from "../world/math";
import { alterGround, constructRock, erodeFacets } from "./groundLedger";
import { groundOf } from "./ground";
import { compileMix } from "./modes";
import { fractalNoise } from "../world/noise";
import { rockCatalogue, type RockKind, type RockKindId } from "./rockCatalogue";
import type { MaterialLayer } from "./rockColumn";
import { leakFromColumn } from "./rockMagicStock";
import type { MapScale } from "@atlas/domain";

/**
 * Each system makes or changes material through its own medium. The retained column then wears, buries and
 * carries like any other. What it makes shows on the map only as far as the processes that follow
 * leave it exposed. Depth/rate constants are map-length fractions, resolved before ground work;
 * intensities retain the field's own scale.
 */
/** Rock that stands proud of its surroundings by what it has made: real height and a layer. */
function addRock(map: PhysicalField, cell: number, kind: RockKindId, fraction: number) {
  const amount = units(map.scale.length(fraction));
  if (amount <= 0) return;
  constructRock(map, cell, amount, rockCatalogue[kind], "magic rock", "space");
}
const onLand = (map: PhysicalField, cell: number) => map.WaterKindCodes.get(cell) === 0;
/** Active protection limits reach; altered stone survives independently of this forcing. */
const unwarded = (map: PhysicalField, cell: number) => 1 - clamp(map.Warding.get(cell), 0, 1);
/** Alteration preserves the substrate's formation and fabric, and records when it changed. */
export function magicMaterial(was: MaterialLayer, kind: RockKind, epoch: number): MaterialLayer {
  if (was.kind === kind.code && was.secondaryShare === 0) return was;
  return {
    ...was,
    kind: kind.code,
    secondaryKind: kind.code,
    secondaryShare: 0,
    strength: kind.resistance,
    altered: epoch,
  };
}
function alterSurface(
  map: PhysicalField,
  cell: number,
  kind: RockKind,
  depth: number,
  protectedKind = -1,
  from: "surface" | "rock" = "surface",
  offset = 0
) {
  alterGround(map, cell, {
    depth,
    from,
    offset,
    transform: (was) =>
      was.kind === protectedKind ? was : magicMaterial(was, kind, map.CompletedEpochCount),
  });
}

/** Body width as a map-length fraction, and noise spread about its middle. */
const bodyScale = 0.06,
  bodySpread = 0.2;
/** Where a point falls among all the map's ground, in [0, 1], in patches that hold together. */
export function bodyRank(x: number, y: number, salt: number, scale: MapScale) {
  return 1 / (1 + Math.exp(-fractalNoise(x, y, salt, scale.length(bodyScale), 2) / bodySpread));
}
/**
 * A system covers a share of the ground, and on a coarse map that share is the share of cells that
 * are its rock. The cells are the ones ranked lowest in a patchy field, so its rock forms bodies, and
 * the same ones on every pass, so they build; a roll for each cell alone would only make static.
 */
function inBody(map: PhysicalField, cell: number, share: number, salt: number) {
  const x = map.mesh.origin[0] + map.mesh.x(cell),
    y = map.mesh.origin[1] + map.mesh.y(cell);
  return bodyRank(x, y, salt, map.scale) < share;
}
const systemSalt = (field: MagicField, seed: number) =>
  seed ^ 0x7e20 ^ field.definition.id.length ^ (field.definition.id.charCodeAt(0) << 8);
const reaches = (map: PhysicalField, field: MagicField, cell: number, seed: number) =>
  inBody(map, cell, field.systemCoverage.get(cell), systemSalt(field, seed));
/** Fire hardens the stone a vein runs through; a spent conduit seals; a fallen core throws debris. */
const veinFrom = 450,
  veinSurfacesFrom = 750;
// length-unit: fraction
const veinDepth = 0.00015,
  veinRoof = 0.00002,
  sinterMetres = 0.00003;
/** Mineral emplacement belongs to the sealing event, not every later visit to a spent conduit. */
export function sealConduitRock(map: PhysicalField, cell: number) {
  addRock(map, cell, "sinter", sinterMetres * unwarded(map, cell));
}
function fireInRock(
  map: PhysicalField,
  field: MagicField,
  cell: number,
  seed: number,
  span: number
) {
  if (!reaches(map, field, cell, seed)) return;
  const heat = field.intensity.get(cell);
  if (heat >= veinFrom && map.FractureConductance.get(cell) > 0) {
    alterSurface(
      map,
      cell,
      rockCatalogue.veinrock,
      units(
        map.scale.length(
          (((veinDepth * span * heat) / 1000) *
            unwarded(map, cell) *
            Math.max(0, field.definition.effects.rockResistance)) /
            900
        )
      ),
      -1,
      "rock",
      heat >= veinSurfacesFrom ? 0 : units(map.scale.length(veinRoof))
    );
  }
}
/** Aurora rots rock open to the sky, ice shields what it covers, and charge grows crystal in it. */
const rotFrom = 250,
  rotMetres = 0.000065,
  rotOdds = 0.25,
  crystalFrom = 350,
  crystalMetres = 0.0000375;
function auroraInRock(map: PhysicalField, field: MagicField, cell: number, seed: number) {
  const charge = field.stored.get(cell),
    iced = map.IceThickness.get(cell) > 0;
  // Crystal grows on the bed under charged ice, and is what the ice leaves when it goes.
  if (iced && Math.max(field.source.get(cell), charge) >= crystalFrom)
    alterSurface(
      map,
      cell,
      rockCatalogue.auroraCrystal,
      units(map.scale.length(crystalMetres * unwarded(map, cell)))
    );
  if (iced || charge < rotFrom || !onLand(map, cell)) return;
  // Charge left in open ground is what Aurora has there: its share of the ground rots.
  if (inBody(map, cell, (charge / 1000) * rotOdds, systemSalt(field, seed) ^ 0x7e13))
    alterSurface(
      map,
      cell,
      rockCatalogue.rimerot,
      units(
        map.scale.length(
          (((rotMetres * charge * unwarded(map, cell)) / 1000) *
            Math.max(0, -field.definition.effects.rockResistance)) /
            520
        )
      )
    );
}
/** Pressure's rays crush the sea floor and shore they strike, and the sea then cuts what it broke. */
const crushFrom = 300,
  crushMetres = 0.000045;
/** Rays act on the seabed and on the rock face immediately beside the water they occupy. */
function pressureAtRock(map: PhysicalField, field: MagicField, cell: number) {
  if (!onLand(map, cell)) return field.intensity.get(cell);
  let force = 0;
  for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
    const neighbor = map.mesh.neighbor(cell, edge);
    if (neighbor >= 0 && map.WaterKindCodes.get(neighbor) === 1)
      force = Math.max(force, field.intensity.get(neighbor));
  }
  return force * field.definition.effects.coastalForcing;
}
function pressureInRock(map: PhysicalField, field: MagicField, cell: number, seed: number) {
  const force = pressureAtRock(map, field, cell);
  if (force < crushFrom || (!onLand(map, cell) && !reaches(map, field, cell, seed))) return;
  alterSurface(
    map,
    cell,
    rockCatalogue.crushstone,
    units(map.scale.length((crushMetres * force * unwarded(map, cell)) / 1000))
  );
}
/** Greenwood's roots open the top of the rock, its springs lay tufa, its water takes soluble rock. */
const rootFrom = 350,
  rootMetres = 0.0000175,
  springFrom = 300,
  tufaMetres = 0.0000045,
  dissolveFrom = 200,
  dissolveMetres = 0.00003;
const dissolving = compileMix({ solution: 1 });
function greenwoodInRock(
  map: PhysicalField,
  field: MagicField,
  cell: number,
  seed: number,
  span: number
) {
  if (!onLand(map, cell) || !reaches(map, field, cell, seed)) return;
  const growth = field.intensity.get(cell);
  // What water dissolves goes down to where the water does, and no further.
  if (growth >= dissolveFrom)
    erodeFacets(
      map,
      cell,
      groundOf(map).surfaceAction(
        cell,
        dissolving,
        map.scale.length((dissolveMetres * span * growth) / 1000),
        Infinity,
        map.EffectiveSeaLevel
      ),
      "greenwood"
    );
  if (growth >= rootFrom)
    alterSurface(
      map,
      cell,
      rockCatalogue.rootstone,
      units(map.scale.length((rootMetres * growth * unwarded(map, cell)) / 1000))
    );
  if ((field.originSources.spring?.get(cell) ?? 0) >= springFrom)
    addRock(map, cell, "tufa", tufaMetres * span * unwarded(map, cell));
}
/** Veil damages the reached body; its coherent displacement is owned by veilWrites. */
const shuffleFrom = 0.25,
  tornMetres = 0.0000225;
function veilInRock(map: PhysicalField, field: MagicField, cell: number, seed: number) {
  const wild = field.wild.get(cell);
  if (wild < shuffleFrom || !reaches(map, field, cell, seed)) return;
  alterSurface(
    map,
    cell,
    rockCatalogue.tornstone,
    units(map.scale.length(tornMetres * wild * unwarded(map, cell)))
  );
}
/** How thick the ground a ward holds is: enough to stand while the land around it wears. */
const keptMetres = 0.000075;
/** Hallowed keeps the ground it wards as it is, and it stands while the land around it wears. */
function hallowedInRock(map: PhysicalField, cell: number, hardening: number) {
  if (onLand(map, cell))
    alterSurface(
      map,
      cell,
      rockCatalogue.keptStone,
      units(map.scale.length(keptMetres * clamp(map.Warding.get(cell), 0, 1) * hardening))
    );
}
/** Society can establish lasting kept ground after the geological epoch sequence. */
export function hallowedOnTheColumn(state: GenerationState) {
  const map = state.physical!.map;
  for (const field of state.physical!.magic!.fields) {
    if (!field.definition.enabled || field.definition.effects.warding <= 0) continue;
    const hardening = Math.max(0, field.definition.effects.rockResistance) / 300;
    for (let cell = 0; cell < map.mesh.count; cell++)
      if (map.Warding.get(cell) > 0) hallowedInRock(map, cell, hardening);
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
    for (const field of systems.fire) fireInRock(map, field, cell, seed, span);
    for (const field of systems.aurora) auroraInRock(map, field, cell, seed);
    for (const field of systems.pressure) pressureInRock(map, field, cell, seed);
    for (const field of systems.greenwood) greenwoodInRock(map, field, cell, seed, span);
    for (const field of systems.tearing) veilInRock(map, field, cell, seed);
  }
  hallowedOnTheColumn(state);
}
const meetingMetres = 0.000035;
/** A meeting's coverage is the share of the cell it has changed, not a change to the whole of it. */
export function meetingInRock(
  map: PhysicalField,
  made: RockKindId | undefined,
  cell: number,
  coverage: number,
  salt: number
) {
  if (!made || !inBody(map, cell, coverage, salt)) return;
  alterSurface(
    map,
    cell,
    rockCatalogue[made],
    units(map.scale.length(meetingMetres * unwarded(map, cell)))
  );
}
