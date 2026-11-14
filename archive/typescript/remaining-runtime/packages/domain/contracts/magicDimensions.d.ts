import { MapScale } from "./mapScale";
import type { MagicSystem } from "./magicSystems";
import type { MagicConfluence } from "./magicConfluences";
/** Dimensional exponents, including intensity stocks carried per unit area or volume. */
export declare const magicParameterDimensions: {
  readonly sourceSpacing: 1;
  readonly iceRetention: 1;
  readonly coldRetentionDistance: 1;
  readonly accumulationArea: 2;
  readonly featureNoiseScale: 1;
  readonly rayDistance: 1;
  readonly coastalRayDistance: 1;
  readonly wakeDistance: 1;
  readonly beamWidth: 1;
  readonly coastalSourceDistance: 1;
  readonly fallenDensity: -1;
  readonly iceCrackDepth: 1;
  readonly buryDepth: 1;
  readonly fanBarrenDepth: 1;
  readonly iceChargeSaturation: -1;
  readonly thawSubsidence: 1;
  readonly sinkDepth: 1;
  readonly springFlow: 3;
  readonly springChargeSaturation: -1;
  readonly saltPerDeath: 2;
  readonly saltPerLakeMetre: -1;
  readonly saltMaterialDensity: -1;
  readonly domeRise: 1;
  readonly wardReach: 1;
  readonly doorDistance: 1;
  readonly wildRelief: 1;
  readonly doorPool: 1;
  readonly doorTravel: 1;
};
export type ResolvedMagicSystem = Omit<MagicSystem, "lengthUnits"> & {
  lengthUnits: "resolved";
};
export type ResolvedConfluence = Omit<MagicConfluence, "lengthUnits"> & {
  lengthUnits: "resolved";
};
/** Configuration becomes measured quantities only when attached to its owning map. */
export declare function resolveMagicSystem(
  system: MagicSystem,
  scale: MapScale
): ResolvedMagicSystem;
export declare function resolveConfluences(
  definitions: MagicConfluence[],
  scale: MapScale
): ResolvedConfluence[];
