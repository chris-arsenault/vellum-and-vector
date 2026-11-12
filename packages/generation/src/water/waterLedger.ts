import { transferRecord } from "../coupling/flows";
import type { PhysicalField } from "../world/field";

/**
 * Where water is. A water process is a move between two of these, and every move is entered
 * here, so a pass can state what became of the water that fell: nothing is made or lost
 * unrecorded. The air and the sea are stores like the rest. Volumes are cubic metres a year
 * over the whole map, for the typical year a pass works out.
 */
export const waterStores = [
  "air",
  "snow",
  "ice",
  "soil",
  "ground",
  "river",
  "lake",
  "sea",
  "people",
  /** The country beyond the map's edge. */
  "beyond",
] as const;
export type WaterStore = (typeof waterStores)[number];

/** The ways water moves. Each names the two stores it moves between. */
export const waterMoves = {
  rain: ["air", "soil"],
  snowfall: ["air", "snow"],
  thaw: ["snow", "soil"],
  /** Snow that outlasts the year becomes ice and leaves the year's water. */
  firn: ["snow", "ice"],
  iceMelt: ["ice", "river"],
  evaporation: ["soil", "air"],
  /** Rain that runs before it can soak in, and what full soil sheds over the surface. */
  runoff: ["soil", "river"],
  recharge: ["soil", "ground"],
  spring: ["ground", "river"],
  seepToSea: ["ground", "sea"],
  bedLoss: ["river", "ground"],
  withdrawal: ["river", "people"],
  inflow: ["river", "lake"],
  lakeEvaporation: ["lake", "air"],
  lakeSeepage: ["lake", "ground"],
  spill: ["lake", "river"],
  mouth: ["river", "sea"],
  /** Rivers that cross the map's edge, coming in and going out. */
  entering: ["beyond", "river"],
  leaving: ["river", "beyond"],
  /** Water that reaches the floor of a closed basin holding no lake dries there. */
  pan: ["river", "air"],
} as const satisfies Record<string, readonly [WaterStore, WaterStore]>;
export type WaterMove = keyof typeof waterMoves;

const record = transferRecord(waterStores);
const secondsPerYear = 365.25 * 24 * 3600;

/**
 * States a move of water over the whole map, in cubic metres a year. The ledger describes the
 * typical year as last worked out: each kind of move has one process that works it out, and
 * stating it again replaces what that process said before.
 */
export function moveWater(map: PhysicalField, move: WaterMove, volume: number) {
  const [from, to] = waterMoves[move];
  record.state(map, move, from, to, volume > 0 ? volume : 0);
}
/** Enters a move given as a flow in cubic metres a second. */
export const moveFlow = (map: PhysicalField, move: WaterMove, flow: number) =>
  moveWater(map, move, flow * secondsPerYear);
/** Enters a move given as a depth in millimetres a year over an area in square metres. */
export const moveDepth = (map: PhysicalField, move: WaterMove, millimetres: number, area: number) =>
  moveWater(map, move, (millimetres / 1000) * area);

/** The year's moves in words, each as a share of what fell, for a report. */
export function waterAccountLine(map: PhysicalField) {
  const { moves } = waterAccount(map),
    fell = moves
      .filter((move) => move.from === "air")
      .reduce((total, move) => total + move.volume, 0);
  if (!(fell > 0)) return "no water fell";
  const share = (volume: number) => `${((100 * volume) / fell).toFixed(1)}%`;
  return (
    `of the ${(fell / 1e9).toFixed(1)} cubic km that falls in a year: ` +
    moves.map((move) => `${move.cause} ${move.from} to ${move.to} ${share(move.volume)}`).join(", ")
  );
}
/** What each store gained and lost over the year, and every move, largest first. */
export function waterAccount(map: PhysicalField) {
  const moves = record.read(map),
    net = Object.fromEntries(waterStores.map((store) => [store, 0])) as Record<WaterStore, number>;
  for (const { from, to, volume } of moves) {
    net[from] -= volume;
    net[to] += volume;
  }
  return { moves, net };
}
