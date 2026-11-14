/** The geological interval of a context with no epoch. */
export const tectonicReferenceMyr = 10;
/**
 * How far a plate at full speed travels in an epoch: its speed, for as long as the epoch lasts, by
 * the share of full travel the epoch states. Travel is the epoch's own figure and never follows how
 * strongly the epoch builds: an old world's plates slow while its collisions still raise ranges,
 * and a quiet epoch can still close an ocean (docs/adr/0013-plates-travel-far-apart-from-strength.md).
 *
 * owner-direction(2026-11-07, restated 2026-11-12): plate movement and tectonic strength cannot be coupled.
 */
export function plateTravel(
  profile: { PlateDriftPerMyr: number },
  durationMyr: number,
  travelShare: number
) {
  return profile.PlateDriftPerMyr * Math.max(0, durationMyr) * Math.max(0, travelShare);
}
/** Default physical history interval; ecology and society keep their model years. */
export const tectonicDefaultMyr = 20;
/** Maximum change in boundary driving before contacts are reconciled again. */
export const tectonicStepMyr = 4;
/** Boundary geometry is updated before traveling a substantial province fraction. */
export const tectonicStepTravel = (scale: MapScale) => scale.length(0.0175);
/** Resolve moving geometry before it travels a quarter of a terrain cell. */
export const tectonicGeometryTravelFraction = 0.25;
/** Time for a plate to adjust toward its persistent regional driving. */
export const tectonicRelaxationMyr = 15;
/** Normal resistance of contacting moving units, applied per million years. */
export const tectonicContactMyr = 30;
/** How much of that resistance a closing contact keeps when ocean crust can sink beneath it. */
export const tectonicSubductionResistance = 0;
/** Speed a plate of ocean gains when all its contacts are sinking on one side. */
export const tectonicSlabPull = 1;
/** How far from a bounded map's edge a plate's continent starts to slow against it, in metres. */
export const tectonicEdgeReach = (scale: MapScale) => scale.length(0.075);
/** Share of regional differential driving that contributes plate rotation. */
export const tectonicRotationGain = 0.35;
/** Initial mechanical plates contain several irregular provinces, independently of crust origin. */
export const tectonicInitialProvincesPerPlate = 5;
/** Local differential driving loads internal bonds even while their plate moves coherently. */
export const tectonicLocalDrivingShare = 0.45;
/** Integrated extensional strain at which a mechanical bond fails. */
export const tectonicRiftFailure = 0.28;
/** Maximum ductile share of local driving before a throughgoing rupture. */
export const tectonicDuctileCompliance = 0.2;
/** How much harder a continent's interior is to break than crust around it: cratons rarely rift. */
export const tectonicContinentBondStrength = 4;
/** A welded seam's strength against what the crust had: old sutures are where continents reopen. */
export const tectonicSutureStrength = 0.25;
/** How long heat gathers under a wide continent or a plume before it pushes at a plate's full speed. */
export const tectonicInsulationMyr = 60;
/** The radius of continent, in metres, that traps heat that fast; a smaller lid traps it slower. */
export const tectonicLidRadius = (scale: MapScale) => scale.length(0.375);
/** How far a plume's spreading head reaches, as a share of the plume's own radius. */
// length-unit: ratio
export const tectonicPlumeHeadReach = 3;
/** Closure, as a share of the distance between provinces, at which colliding continents lock. */
export const tectonicCollisionLock = 0.5;
/** How close an ocean province gets to what it sinks beneath, as a share of its own width. */
// length-unit: ratio
export const tectonicSinkingReach = 0.5;
/** Shortening beyond an earlier opening needed to establish a welded contact. */
export const tectonicWeldStrain = 0.2;
/** Residual closing motion at which an old compressed continental contact can weld. */
export const tectonicWeldSpeed = 0.08;
/** Detectable extensional deformation before a throughgoing rupture. */
export const tectonicRiftActivation = 0.02;
/** Thermal relaxation of thinned continental lithosphere, in million years. */
export const tectonicRiftCoolingMyr = 30;
/** Maximum extra subsidence at a fully extended rift, multiplied by its configured response. */
export const tectonicRiftSubsidence = (scale: MapScale) => scale.length(0.0004);
/** Oceanic lithosphere approaches the mature subsidence state over this geological interval. */
export const tectonicOceanMaturityMyr = 80;
/** Melt supplied to the overriding arc per unit of consumed oceanic column. */
export const tectonicArcMeltShare = 0.18;
/** Horizontal distance from the consuming contact to the overriding volcanic front. */
export const tectonicArcOffset = (scale: MapScale) => scale.length(0.03);
/** Width of a volcanic front's physical construction footprint. */
export const tectonicArcRadius = (scale: MapScale) => scale.length(0.02);
import type { MapScale } from "@atlas/domain";
