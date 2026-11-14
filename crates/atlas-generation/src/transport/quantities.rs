//! Quantity semantics from the shared physical field, independent of the process moving it.
use crate::field::shared::{CellCode, Scalar};
use crate::rock::ground::GroundField;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QuantityKind {
    Share,
    Amount,
    Peak,
    Identity,
    Crust,
    Ground,
    Carried,
    Derived,
}
impl Scalar {
    /// Exhaustive so adding a physical channel requires declaring what moving ground does to it.
    pub fn quantity(self) -> QuantityKind {
        use QuantityKind::*;
        use Scalar::*;
        match self {
            CrustAge
            | ImpactHeat
            | TreeCover
            | GrassCover
            | WetlandCover
            | FireActivity
            | BroadleafCover
            | ConiferCover
            | BroadleafSaplings
            | ConiferSaplings
            | GrassSeed
            | BroadleafSeed
            | ConiferSeed
            | WetlandSeed
            | EcologicalDamage
            | EcologicalToxicity
            | Infiltration
            | CanopyAge
            | Evapotranspiration
            | Productivity
            | AquaticProductivity
            | OrganicBurialDepth
            | OrganicMaturity
            | EcologyStillness
            | CrustRiftStrain
            | CrustRiftAgeMyr
            | Quickening
            | Stillness
            | IcePersistence
            | IceCharge
            | ExternalUpwelling
            | ExternalSeaSurfaceForcing
            | FogForcing
            | StormForcing
            | StormTrack
            | FirstEpochHeight
            | Verdure
            | Salting
            | Warding
            | Tearing => Share,
            TectonicActivityHistory
            | CumulativeFluvialErosion
            | CumulativeGlacialErosion
            | CumulativeGlacialDeposition
            | CumulativeCoastalErosion
            | OceanicSubduction
            | OceanicSubductionHistory
            | ImpactExcavation
            | ImpactRimUplift
            | ImpactEjectaThickness
            | VolcanicConstructionHistory
            | VolcanicMeltSupply
            | SoilCarbon
            | PeatCarbon
            | AquaticCarbon
            | BuriedPlantCarbon
            | BuriedAquaticCarbon
            | CoalCarbon
            | OilCarbon
            | GasCarbon
            | EcologySediment
            | EcologyVolcanic
            | EcologyImpact
            | EcologyErosion
            | EcologyIce
            | Grazers
            | Browsers
            | MineralNutrients
            | MigrationFlux
            | Herbivores
            | Predators
            | AquaticFauna => Amount,
            WaveExposureHistory
            | GeothermalHistory
            | ExternalCoastalForcingHistory
            | FractureConductance
            | MaximumIceFlux
            | MaximumGroundedIceFlux
            | MaximumIceThickness => Peak,
            CrustBasePotential
            | CrustAssemblySeparation
            | CrustCollisionIntensity
            | CrustMotionX
            | CrustMotionY
            | ContinentalPotential
            | Temperature
            | WindX
            | WindY
            | MoistureBarriers
            | PrecipitationBarriers
            | TectonicStrain
            | InitialTectonicStrain
            | TectonicTangentX
            | TectonicTangentY
            | OceanCurrentX
            | OceanCurrentY
            | OceanCurrentStrength
            | OceanCurrentHeat
            | SeaSurfaceAnomaly
            | Upwelling
            | WaveExposure
            | SeaIceSuitability
            | ExternalHeatForcing
            | ExternalCoastalForcing
            | Moisture
            | Geothermal
            | MantlePlumeRootStrength
            | VolcanicActivity
            | FloodplainIntensity
            | DeltaIntensity
            | IceBalance
            | HeatSourceDensity
            | Warmth
            | OrogenicConstruction
            | ConvergentCrustSurplus
            | LandmarkMaintenance
            | Slope
            | FloodFrequency
            | OceanMarginDistance
            | OceanDistance
            | Seasonality
            | AirDemand
            | WindSpeed
            | Rainfall
            | Snowfall
            | OrganicBurialInput
            | OrganicBurialThickness
            | ColumnPrecipitation
            | IceFlux
            | IceThickness
            | IceRetreat => Derived,
        }
    }
}
impl CellCode {
    pub fn quantity(self) -> QuantityKind {
        use CellCode::*;
        match self {
            BiomeCodes
            | CrustAssemblyIds
            | CrustPlateIds
            | VolcanicLastActiveEpoch
            | FeatureFlags => QuantityKind::Identity,
            CrustProvinceIds
            | CrustTypeCodes
            | AdvectionSourceIndex
            | MarginCodes
            | CoastalMarginCodes
            | UpwindTargets
            | UpwindOceanSources
            | TectonicBoundaryCodes
            | InitialTectonicBoundaryCodes
            | TectonicBoundaryPairIds
            | OrogenicComponentIds
            | LandformCodes
            | LandmassIds
            | LandmassClassCodes
            | ContinentalGroupIds
            | BathymetricZoneCodes
            | IceFlowTargets => QuantityKind::Derived,
        }
    }
}
impl GroundField {
    pub fn quantity(self) -> QuantityKind {
        use GroundField::*;
        match self {
            CrustSupportTarget => QuantityKind::Derived,
            SoilDepth | CumulativeDeposition => QuantityKind::Amount,
            CrustThickness
            | CrustContinentalColumn
            | CrustContinentalFraction
            | CrustRootReserve => QuantityKind::Crust,
            Elevation
            | BedrockElevation
            | CrustSupportElevation
            | SurfaceRockLoad
            | SedimentThickness
            | RockResistance
            | RockKindCodes
            | GroundCutShare
            | GroundCutDepth
            | GroundCutCover
            | StructuralGrainX
            | StructuralGrainY
            | ThrustPairIds
            | ThrustSheetIndex
            | ThrustSegmentIds
            | ThrustAcross
            | ThrustDip
            | CrustSutureStrength
            | CrustSuturePairIds
            | CrustProvinceSeam => QuantityKind::Ground,
        }
    }
}

/// A share averages its arrivals, blending fresh crust into a rift. Amounts retain all arrivals.
pub fn arrived(kind: QuantityKind, sum: f64, arrival: f64, boundary: i32, fresh: f64) -> f64 {
    use super::TRANSPORT_WEIGHT_SCALE as SCALE;
    if arrival <= 0.0 {
        return if kind == QuantityKind::Share {
            fresh
        } else {
            0.0
        };
    }
    if kind == QuantityKind::Amount {
        sum / SCALE
    } else if kind == QuantityKind::Share && boundary == 2 && arrival < SCALE {
        (sum + fresh * (SCALE - arrival)) / SCALE
    } else {
        sum / arrival
    }
}

#[derive(Clone, Copy)]
pub enum IdentityPick {
    Heaviest,
    Latest,
    Every,
}
pub struct IdentityRule {
    pub pick: IdentityPick,
    pub weighted: bool,
    pub least: f64,
    pub clears: i32,
}
impl CellCode {
    pub fn identity_rule(self) -> Option<IdentityRule> {
        use CellCode::*;
        let (pick, weighted, least, clears) = match self {
            CrustAssemblyIds => (IdentityPick::Heaviest, true, 0.0, 0),
            CrustPlateIds => (IdentityPick::Heaviest, false, 0.0, 0),
            VolcanicLastActiveEpoch => (IdentityPick::Latest, false, 0.05, 0),
            FeatureFlags => (
                IdentityPick::Every,
                false,
                0.05,
                (1 << 8) | (1 << 9) | (1 << 10),
            ),
            _ => return None,
        };
        Some(IdentityRule {
            pick,
            weighted,
            least,
            clears,
        })
    }
}
#[derive(Clone, Copy)]
pub struct IdentityChoice {
    pub value: i32,
    pub held: f64,
}
impl IdentityChoice {
    pub fn offer(&mut self, rule: &IdentityRule, id: i32, weight: f64, by: f64) {
        if weight < rule.least * super::TRANSPORT_WEIGHT_SCALE {
            return;
        }
        match rule.pick {
            IdentityPick::Every => self.value |= id,
            IdentityPick::Latest => self.value = self.value.max(id),
            IdentityPick::Heaviest => {
                if rule.weighted && (id <= 0 || by <= 0.0) {
                    return;
                }
                let contribution = weight * by;
                if contribution < self.held
                    || (contribution == self.held && self.held > 0.0 && id >= self.value)
                {
                    return;
                }
                self.value = id;
                self.held = contribution;
            }
        }
    }
    pub fn settle(self, rule: &IdentityRule, holds: bool, initial: i32) -> i32 {
        if holds {
            self.value
        } else if rule.clears != 0 {
            self.value & !rule.clears
        } else {
            initial
        }
    }
}
