/** Distance scale of a normalized unit velocity over the reference interval. */
export const tectonicReferenceMyr = 10;
/** Default physical history interval; ecology and society keep their model years. */
export const tectonicDefaultMyr = 20;
/** Maximum change in boundary driving before contacts are reconciled again. */
export const tectonicStepMyr = 4;
/** Boundary geometry is updated before traveling a substantial province fraction. */
export const tectonicStepTravel = 70_000;
/** Resolve moving geometry before it travels a quarter of a terrain cell. */
export const tectonicGeometryTravelFraction = 0.25;
/** Time for a plate to adjust toward its persistent regional driving. */
export const tectonicRelaxationMyr = 15;
/** Normal resistance of contacting moving units, applied per million years. */
export const tectonicContactMyr = 30;
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
/** Shortening beyond an earlier opening needed to establish a welded contact. */
export const tectonicWeldStrain = 0.2;
/** Residual closing motion at which an old compressed continental contact can weld. */
export const tectonicWeldSpeed = 0.08;
/** Detectable extensional deformation before a throughgoing rupture. */
export const tectonicRiftActivation = 0.02;
/** Thermal relaxation of thinned continental lithosphere, in million years. */
export const tectonicRiftCoolingMyr = 30;
/** Maximum extra subsidence at a fully extended rift, multiplied by its configured response. */
export const tectonicRiftSubsidence = 1600;
/** Oceanic lithosphere approaches the mature subsidence state over this geological interval. */
export const tectonicOceanMaturityMyr = 80;
/** Melt supplied to the overriding arc per unit of consumed oceanic column. */
export const tectonicArcMeltShare = 0.18;
/** Horizontal distance from the consuming contact to the overriding volcanic front. */
export const tectonicArcOffset = 120_000;
/** Width of a volcanic front's physical construction footprint. */
export const tectonicArcRadius = 80_000;
