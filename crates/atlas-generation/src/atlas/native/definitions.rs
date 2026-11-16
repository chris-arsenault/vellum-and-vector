use super::{Declaration, NativeStep, NativeSteps, Part};
use crate::{
    atlas::{environment::Environment, terrain::Terrain},
    execution::{Command, ExecutionResult, Query},
    field::{water::network::RiverEvolution, Field},
    processes::{fluvial, runner::PhysicalContext},
};
use Part as P;

// These declarations are expanded for execution and review from the same owner definitions.
macro_rules! declarations {
    ($step:ident, $terrain:ident, $water:ident, $open_boundary:ident) => {
        $step!("crustal-support", 0, "CrustThickness" => "CrustSupportTarget", P::query(&$terrain.support));
        $step!("crustal-relaxation", 0, "CrustThickness CrustProvinceIds" => "CrustThickness", P::physical(&$terrain.relaxation));
        $step!("lithospheric-flexure", 0, "CrustSupportTarget" => "Elevation BedrockElevation CrustSupportElevation", P::unit(&$terrain.flexure));
        $step!("ocean-connectivity", 0, "Elevation" => "WaterKindCodes WaterDepths WaterSurfaceElevations WaterBodyIds", P::physical(&$water.ocean_budget), P::query(&$water.ocean), P::physical(&$water.ocean_memory));
        $step!("mass-wasting", 0, "Elevation RockKindCodes" => "Elevation BedrockElevation SedimentThickness", P::physical(&$terrain.mass_wasting));
        $step!("continental-margin-evolution", 0, "Elevation WaterKindCodes MarginCodes" => "Elevation BedrockElevation CoastalMarginCodes OceanMarginDistance", P::unit(&$terrain.margin_evolution));
        $step!("marine-sedimentation", 0, "Elevation WaterKindCodes OceanMarginDistance" => "Elevation SedimentThickness CumulativeDeposition", P::unit(&$terrain.sea_floor));
        $step!("fracture-network", 0x6f9d2b1, "TectonicStrain" => "FractureConductance", P::physical(&$terrain.fractures));
        $step!("geothermal", 0x152b37, "TectonicBoundaryCodes FractureConductance" => "Geothermal HeatSourceDensity", P::query(&$water.geothermal));
        $step!("continental-sutures", 0, "TectonicBoundaryCodes CrustContinentalFraction" => "CrustSutureStrength CrustCollisionIntensity", P::physical(&$terrain.sutures));
        $step!("tectonic-margins", 0, "TectonicBoundaryCodes CrustContinentalFraction" => "MarginCodes CrustAge", P::physical(&$terrain.margins));
        $step!("continental-domains", 0x12e5a91, "TectonicBoundaryCodes" => "ContinentalPotential", P::query(&$terrain.domains));
        $step!("tectonic-uplift", 0x4f2b17, "CrustProvinceIds ContinentalPotential" => "Elevation BedrockElevation CrustThickness", P::physical(&$terrain.uplift));
        $step!("tectonic-provinces", 0x6b31e7, "" => "CrustProvinceIds CrustPlateIds CrustContinentalFraction CrustMotionX CrustMotionY TectonicBoundaryCodes InitialTectonicBoundaryCodes TectonicStrain", P::command(&$terrain.provinces, |context| context.seed));
        $step!("orogenic-construction", 0x7249d3, "Elevation CrustProvinceIds RockKindCodes" => "Elevation BedrockElevation CrustThickness OrogenicConstruction", P::physical(&$terrain.mountains));
        $step!("volcanic-construction", 0x73a91d, "Elevation RockKindCodes" => "Elevation BedrockElevation VolcanicConstructionHistory VolcanicMeltSupply VolcanicActivity FractureConductance", P::physical(&$terrain.volcanoes));
        $step!("impact-cratering", 0x4d73a1, "Elevation RockKindCodes" => "Elevation BedrockElevation SedimentSupply ImpactExcavation FractureConductance", P::physical(&$terrain.impacts));
        $step!("landscape-initialization", 0, "CrustProvinceIds" => "RockKindCodes RockResistance CrustSupportElevation BedrockElevation", P::command(&$terrain.landscape, |context| context.seed));
        $step!("mantle-plume-roots", 0x37c1, "CrustProvinceIds" => "MantlePlumeRootStrength", P::physical(&$terrain.plumes));
        $step!("coastal-detail", 0x2ba7d1, "Elevation MarginCodes" => "Elevation BedrockElevation", P::physical(&$terrain.shore_detail));
        $step!("tectonic-epoch-activity", 0x1d71c3, "InitialTectonicBoundaryCodes" => "TectonicBoundaryCodes TectonicStrain", P::unit(&$terrain.epoch_activity));
        $step!("land-ice-mass-balance", 0, "Elevation WaterKindCodes Temperature Moisture Snowfall" => "IceThickness IceBalance MaximumIceThickness", P::physical(&$water.land_ice));
        $step!("ice-flow", 0, "Elevation WaterKindCodes IceThickness" => "IceFlux IceFlowTargets GroundedIce", P::physical(&$water.ice_flow));
        $step!("glacial-erosion", 0, "Elevation RockKindCodes IceFlux IceFlowTargets IceThickness" => "Elevation BedrockElevation SedimentSupply", P::physical(&$terrain.glacial_erosion));
        $step!("glacial-deposition", 0, "Elevation IceFlowTargets IceFlux" => "Elevation SedimentThickness CumulativeGlacialDeposition", P::physical(&$terrain.glacial_deposition));
        $step!("glacial-meltwater", 0, "WaterKindCodes Temperature IceThickness SnowKept" => "GlacialMeltwater", P::query(&$water.meltwater));
        $step!("groundwater", 0, "Rainfall Elevation WaterKindCodes" => "GroundwaterStorage GroundwaterExchangeVolume GroundwaterRecharge GroundwaterReturn GroundwaterOutflow GroundwaterTargets", P::physical(&$water.groundwater));
        $step!("external-coastal-forcing", 0, "Elevation WaterKindCodes" => "Elevation BedrockElevation CumulativeCoastalErosion", P::physical(&$terrain.outside_waves));
        $step!("coastal-erosion-and-deposition", 0, "Elevation WaterKindCodes RockKindCodes" => "Elevation BedrockElevation CumulativeCoastalErosion", P::physical(&$terrain.coastal_erosion));
        $step!("glacial-landforms", 0, "Elevation WaterKindCodes" => "LandformCodes", P::query(&$water.glacial_landforms));
        $step!("sea-ice", 0, "WaterKindCodes Temperature" => "SeaIceSuitability", P::physical(&$water.sea_ice));
        $step!("landform-classification", 0, "Elevation WaterKindCodes RiverOrders" => "LandformCodes Slope", P::query(&$water.landforms));
        $step!("river-channel-geometry", 0, "Elevation FlowTargets RiverOrders" => "RiverWidth RiverDepth RiverChannelStrength RiverChannelOrders RiverWarmth", P::query(&$water.channels), P::query(&$water.river_heat));
        $step!("river-floodplains", 0, "Elevation FlowTargets RiverOrders RiverChannelOrders" => "FloodplainIntensity", P::query(&$water.floodplains));
        $step!("river-delta-formation", 0, "WaterKindCodes FlowTargets RiverOrders RiverChannelOrders" => "DeltaIntensity", P::query(&$water.deltas));
        $step!("ocean-distance", 0, "WaterKindCodes" => "OceanDistance", P::query(&$water.distance));
        $step!("bathymetry", 0, "Elevation WaterKindCodes" => "BathymetricZoneCodes Slope", P::query(&$water.bathymetry));
        $step!("landmasses-and-shelf-groups", 0, "Elevation WaterKindCodes" => "LandmassIds LandmassClassCodes ContinentalGroupIds", P::query(&$water.landmasses));
        $step!("ocean-currents", 0x6c41e2, "WaterKindCodes WaterDepths" => "OceanCurrentX OceanCurrentY OceanCurrentStrength WaveExposure", P::query(&$water.currents));
        $step!("warmth-sources", 0x4a51c73, "Elevation WaterKindCodes" => "Warmth", P::query(&$water.warmth));
        $step!("atmospheric-climate", 0x4e28b3, "Elevation WaterKindCodes" => "Temperature Seasonality AirDemand WindX WindY WindSpeed UpwindTargets UpwindOceanSources MoistureBarriers PrecipitationBarriers Moisture ColumnPrecipitation StormTrack Rainfall Snowfall", P::query(&$water.atmosphere));
        $step!("runoff", 0, "WaterKindCodes Temperature Rainfall" => "WaterRecharge SnowKept SoilWater SnowPack SurfaceWaterMonth0 SurfaceWaterMonth1 SurfaceWaterMonth2 SurfaceWaterMonth3 SurfaceWaterMonth4 SurfaceWaterMonth5 SurfaceWaterMonth6 SurfaceWaterMonth7 SurfaceWaterMonth8 SurfaceWaterMonth9 SurfaceWaterMonth10 SurfaceWaterMonth11 Runoff FloodRunoff DryRunoff", P::physical(&$water.water_transfer), P::query(&$water.runoff));
        $step!("current-water", 0, "Runoff FlowTargets" => "RiverOrders CatchmentArea FlowAccumulation SmallChannelLength SeepageRecharge FloodFlow PerennialFlow FlowingMonths", P::query(&$water.rivers));
        $step!("drainage-conditioning", 0, "Elevation WaterKindCodes" => "DrainageElevations DrainageParents DrainageRanks", P::query(&$water.conditioning));
        $step!("lake-basins", 0x7a31, "Elevation WaterKindCodes Runoff DrainageElevations IceThickness" => "LakeOutletTargets LakeOverflow WaterKindCodes WaterDepths WaterSurfaceElevations", P::query(&$water.lakes));
        $step!("drainage-guidance", 0x61bd23, "Elevation WaterKindCodes DrainageElevations" => "DrainageGuidanceTargets", P::query(&$water.guidance));
        $step!("flow-routing", 0, "WaterKindCodes DrainageParents DrainageGuidanceTargets" => "FlowTargets FlowEdges DrainageBasinIds", P::query(&$water.routing));
        $step!("river-network", 0, "Runoff FlowTargets" => "RiverOrders SmallChannelLength CatchmentArea FlowAccumulation SeepageRecharge FloodFlow PerennialFlow FlowingMonths", P::command(&$water.river_evolution, |_| RiverEvolution { channel_length: None }), P::query(&$water.rivers));
        $step!("ancestral-fluvial-erosion", 0, "Elevation WaterKindCodes RockKindCodes" => "Elevation BedrockElevation SedimentSupply", P::physical(&$terrain.fluvial_erosion));
        $step!("post-fluvial-mass-wasting", 0, "Elevation RockKindCodes" => "Elevation BedrockElevation SedimentThickness", P::physical(&$terrain.post_fluvial_slopes));
        $step!("sediment-transport", 0, "Elevation FlowTargets CatchmentArea" => "Elevation SedimentThickness CumulativeDeposition", P::command(&$terrain.sediment.transport, move |context| fluvial::Context { span: context.span, $open_boundary }));
        $step!("lithification", 0, "Elevation RockKindCodes" => "RockKindCodes BedrockElevation", P::physical(&$terrain.burial));
        $step!("rock-metamorphism", 0, "RockResistance" => "RockKindCodes RockResistance", P::unit(&$terrain.baking));
        $step!("physical-epoch-history", 0, "Elevation" => "FirstEpochHeight", P::physical(&$terrain.epoch_record));
    };
}
const PLATE: Declaration = Declaration {
    needs: "CrustProvinceIds RockKindCodes",
    writes: "Elevation BedrockElevation CrustThickness CrustPlateIds CrustProvinceIds",
    leaves: "",
};
const VALIDATION: Declaration = Declaration {
    needs: "WaterKindCodes FlowTargets",
    writes: "",
    leaves: "atlas:validated",
};
pub(super) fn contracts() -> Vec<crate::products::ProductContract> {
    let mut contracts = Vec::new();
    macro_rules! contract {
        ($name:literal, $salt:expr, $needs:literal => $writes:literal, $($part:expr),+ $(,)?) => {
            contracts.push(
                Declaration {
                    needs: $needs,
                    writes: $writes,
                    leaves: "",
                }
                .contract($name),
            );
        };
    }
    declarations!(contract, terrain, water, open_boundary);
    contracts.push(PLATE.contract("plate-advection"));
    contracts.push(VALIDATION.contract("physical-structural-validation"));
    contracts
}

impl NativeSteps {
    pub fn new(
        terrain: &Terrain,
        water: &Environment,
        validation: &Query<Field, ()>,
        open_boundary: bool,
        plates: impl FnOnce(&Self) -> ExecutionResult<Command<Field, PhysicalContext>>,
    ) -> ExecutionResult<Self> {
        let mut definitions = Self::base(terrain, water, validation, open_boundary)?;
        let plates = plates(&definitions)?;
        let at = definitions
            .0
            .iter()
            .position(|step| step.name == "tectonic-epoch-activity")
            .unwrap();
        definitions.0.insert(
            at,
            NativeStep::new("plate-advection", 0, PLATE, vec![Part::physical(&plates)])?,
        );
        Ok(definitions)
    }
    fn base(
        terrain: &Terrain,
        water: &Environment,
        validation: &Query<Field, ()>,
        open_boundary: bool,
    ) -> ExecutionResult<Self> {
        let mut steps = Vec::new();
        // Source process contracts stay beside their executable definitions.
        // Features select both registration and occurrence order.
        macro_rules! step {
            ($name:literal, $salt:expr, $needs:literal => $writes:literal, $($part:expr),+ $(,)?) => {
                steps.push(NativeStep::new($name, $salt, Declaration { needs: $needs, writes: $writes, leaves: "" }, vec![$($part),+])?);
            };
        }
        declarations!(step, terrain, water, open_boundary);
        steps.push(NativeStep::new(
            "physical-structural-validation",
            0,
            VALIDATION,
            vec![P::query(validation)],
        )?);
        Ok(Self(steps))
    }
}
