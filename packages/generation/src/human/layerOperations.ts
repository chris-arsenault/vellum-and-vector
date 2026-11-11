import type { HumanLayerId, ReadBand } from "@atlas/domain";
import { defineCommand } from "../processOperation";
import type { PhysicalField } from "../world/field";
import type { TransportPlan } from "../world/transportPlan";
import { humanLayerWriter, type TraditionCodes } from "./humanLayers";
import type { IdentityTraditions } from "./identityColumn";
import type { CompiledLayerMix } from "./layerCatalogue";

/**
 * The operations that change people's layers. They are the only way in: a process works out
 * what should happen as bands of per-cell amounts and submits one of these.
 */
type Values = Pick<ReadBand, "get">;
interface OnMap {
  map: PhysicalField;
}
export interface LayLayer extends OnMap {
  kind: HumanLayerId;
  /** Per cell: a share of the cell's area for an area kind, an amount otherwise. */
  amount: Values;
}
export interface MoveLayer extends OnMap {
  kind: HumanLayerId;
  /** Per cell: the cell its holding goes to, or -1. */
  targets: Values;
  /** Per cell: the share of its holding that goes. */
  share: Values;
  /** The years of coming and going the movement stands for, which wear the way. */
  years: number;
}
export interface Dwelling extends OnMap {
  years: number;
}
export interface ConvertLayer extends OnMap {
  from: HumanLayerId;
  to: HumanLayerId;
  amount: Values;
}
export interface OverlayIdentity extends OnMap {
  /** Per tradition the layer names: each cell's code for it, zero where it names none. */
  traditions: TraditionCodes;
  /** Per cell: the people who take the new layer up. */
  people: Values;
  /** How far the new layer resists being overlaid in turn, 0 to 1. */
  hardness: number;
}
export interface WearLayers extends OnMap {
  mix: CompiledLayerMix;
  /** Per cell: how hard the action falls, where 1 is a full attack. */
  intensity: Values;
}
export interface CoverShare extends OnMap {
  /** Per cell: a share of the cell, 0 to 1. */
  share: Values;
}
export interface IdentityPeople extends OnMap {
  people: Values;
}

export const layHumanLayer = defineCommand(
  "human.layers.lay",
  "work",
  ({ map, kind, amount }: LayLayer) => humanLayerWriter(map).lay(kind, amount),
  []
);
export const moveHumanLayer = defineCommand(
  "human.layers.move",
  "work",
  ({ map, kind, targets, share, years }: MoveLayer) =>
    humanLayerWriter(map).move(kind, targets, share, years),
  []
);
export const dwellOnLand = defineCommand(
  "human.layers.dwell",
  "elapsed",
  ({ map, years }: Dwelling) => humanLayerWriter(map).dwell(years),
  []
);
export const convertHumanLayer = defineCommand(
  "human.layers.convert",
  "work",
  ({ map, from, to, amount }: ConvertLayer) => humanLayerWriter(map).convert(from, to, amount),
  []
);
export const overlayIdentity = defineCommand(
  "human.identity.overlay",
  "work",
  ({ map, traditions, people, hardness }: OverlayIdentity) =>
    humanLayerWriter(map).overlay(traditions, people, hardness),
  []
);
export interface RenameTradition extends OnMap {
  tradition: keyof IdentityTraditions;
  /** The code renamed. */
  from: number;
  /** Per cell: the code it becomes there; the same code, or below zero, leaves it alone. */
  to: Values;
}
export const renameTradition = defineCommand(
  "human.identity.rename",
  "event",
  ({ map, tradition, from, to }: RenameTradition) =>
    humanLayerWriter(map).rename(tradition, from, to),
  []
);
export const inheritIdentity = defineCommand(
  "human.identity.inherit",
  "work",
  ({ map }: OnMap) => humanLayerWriter(map).inherit(),
  []
);
export interface HardenIdentity extends OnMap {
  years: number;
  /** The years over which an identity sets as hard as its place can hold it. */
  settling: number;
}
export const hardenIdentity = defineCommand(
  "human.identity.harden",
  "elapsed",
  ({ map, years, settling }: HardenIdentity) => humanLayerWriter(map).harden(years, settling),
  []
);
export const reExposeIdentity = defineCommand(
  "human.identity.re-expose",
  "work",
  ({ map, people }: IdentityPeople) => humanLayerWriter(map).reExposeIdentity(people),
  []
);
export const wearHumanLayers = defineCommand(
  "human.layers.wear",
  "work",
  ({ map, mix, intensity }: WearLayers) => humanLayerWriter(map).wear(mix, intensity),
  []
);
export const buryHumanLayers = defineCommand(
  "human.layers.bury",
  "work",
  ({ map, share }: CoverShare) => humanLayerWriter(map).bury(share),
  []
);
export const reExposeRemains = defineCommand(
  "human.layers.re-expose",
  "work",
  ({ map, share }: CoverShare) => humanLayerWriter(map).reExpose(share),
  []
);
export interface Travel extends OnMap {
  /** Per cell: the travellers who crossed it, times the years they did. */
  travellerYears: Values;
}
export const travelWays = defineCommand(
  "human.layers.travel",
  "elapsed",
  ({ map, travellerYears }: Travel) => humanLayerWriter(map).travel(travellerYears),
  []
);
export interface CarryLayers extends OnMap {
  /** Where each cell's ground went when the plates last moved. */
  plan: TransportPlan;
}
export const carryHumanLayers = defineCommand(
  "human.layers.carry",
  "event",
  ({ map, plan }: CarryLayers) => humanLayerWriter(map).carry(plan),
  []
);
