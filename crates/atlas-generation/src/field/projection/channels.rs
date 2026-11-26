//! Publication declarations from atlasChannels, groundResources and humanChannels.
use crate::{
    human::identity::IDENTITY_SLOTS,
    rock::{columns::Column, layer_bands::MaterialScalar},
};

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quantity {
    Intensive,
    Extensive,
    Category,
}
#[derive(Clone)]
pub struct Channel {
    pub name: String,
    pub unit: &'static str,
    pub quantity: Quantity,
    pub discrete: bool,
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
    pub owners: &'static [&'static str],
    pub layer: &'static str,
    pub material: bool,
}
impl Channel {
    pub(crate) fn new(
        name: impl Into<String>,
        unit: &'static str,
        owners: &'static [&'static str],
        layer: &'static str,
    ) -> Self {
        Self {
            name: name.into(),
            unit,
            quantity: if unit == "category" {
                Quantity::Category
            } else {
                Quantity::Intensive
            },
            discrete: unit == "category",
            minimum: None,
            maximum: None,
            owners,
            layer,
            material: false,
        }
    }
    pub fn selected(&self, enabled: &impl Fn(&str) -> bool) -> bool {
        self.owners.iter().any(|owner| enabled(owner))
    }
}
const FOUNDATION: &[&str] = &["physical.foundation"];
const HUMANS: &[&str] = &["human.cultures", "human.politics", "built.layout"];
fn group(
    into: &mut Vec<Channel>,
    owners: &'static [&'static str],
    layer: &'static str,
    unit: &'static str,
    names: &str,
) {
    into.extend(
        names
            .split_whitespace()
            .map(|name| Channel::new(name, unit, owners, layer)),
    );
}
pub fn physical() -> Vec<Channel> {
    let mut c = Vec::new();
    group(
        &mut c,
        FOUNDATION,
        "elevation",
        "native-length",
        "Elevation",
    );
    group(
        &mut c,
        &["magic.configured"],
        "magic",
        "ratio",
        "Quickening Stillness FogForcing IcePersistence IceCharge Verdure Salting Warding Tearing",
    );
    ecology(&mut c);
    group(
        &mut c,
        FOUNDATION,
        "geology",
        "native-length",
        "SedimentThickness",
    );
    group(
        &mut c,
        &["physical.river-incision"],
        "geology",
        "native-length",
        "CumulativeFluvialErosion",
    );
    group(
        &mut c,
        &["physical.glacial-sculpting"],
        "geology",
        "native-length",
        "CumulativeGlacialErosion CumulativeGlacialDeposition",
    );
    group(
        &mut c,
        &["physical.coastal-evolution"],
        "geology",
        "native-length",
        "CumulativeCoastalErosion ExternalCoastalForcingHistory",
    );
    c.last_mut().unwrap().unit = "per-mille";
    group(
        &mut c,
        &[
            "material.fluvial-transport",
            "physical.glacial-sculpting",
            "physical.coastal-evolution",
            "physical.hillslopes",
        ],
        "geology",
        "native-length",
        "CumulativeDeposition",
    );
    group(
        &mut c,
        &["physical.volcanism"],
        "geology",
        "native-length",
        "VolcanicConstructionHistory VolcanicMeltSupply",
    );
    group(
        &mut c,
        &["physical.volcanism"],
        "geology",
        "category",
        "VolcanicLastActiveEpoch",
    );
    group(
        &mut c,
        &["physical.landmarks"],
        "geology",
        "native-length",
        "LandmarkMaintenance",
    );
    group(
        &mut c,
        &["physical.impacts"],
        "geology",
        "native-length",
        "ImpactExcavation ImpactRimUplift ImpactEjectaThickness",
    );
    water(&mut c);
    group(
        &mut c,
        &[
            "physical.fractures",
            "physical.impacts",
            "physical.volcanism",
        ],
        "geology",
        "per-mille",
        "FractureConductance",
    );
    group(
        &mut c,
        FOUNDATION,
        "geology",
        "rock-strength",
        "RockResistance",
    );
    group(
        &mut c,
        FOUNDATION,
        "geology",
        "per-mille",
        "CrustAge CrustSutureStrength ThrustAcross",
    );
    group(&mut c, FOUNDATION, "geology", "metre", "ThrustDip");
    group(&mut c, FOUNDATION, "geology", "category", "CrustProvinceIds CrustAssemblyIds CrustSuturePairIds MarginCodes RockKindCodes ThrustPairIds ThrustSheetIndex ThrustSegmentIds");
    group(
        &mut c,
        &["physical.geothermal"],
        "geology",
        "per-mille",
        "Geothermal GeothermalHistory",
    );
    group(&mut c, &["physical.tectonic-history"], "geology", "per-mille", "TectonicStrain StructuralGrainX StructuralGrainY CrustMotionX CrustMotionY TectonicActivityHistory");
    group(
        &mut c,
        &["physical.tectonic-history"],
        "geology",
        "category",
        "TectonicBoundaryCodes TectonicBoundaryPairIds",
    );
    group(
        &mut c,
        &["physical.climate"],
        "climate",
        "per-mille",
        "Moisture WindX WindY StormTrack",
    );
    group(
        &mut c,
        &["physical.climate"],
        "climate",
        "native-temperature",
        "Temperature",
    );
    group(
        &mut c,
        &["physical.climate"],
        "climate",
        "deci-celsius",
        "ExternalHeatForcing",
    );
    group(
        &mut c,
        &["physical.climate"],
        "climate",
        "metre/second",
        "WindSpeed",
    );
    group(
        &mut c,
        &["physical.climate"],
        "climate",
        "millimetre/year",
        "Rainfall Snowfall",
    );
    group(
        &mut c,
        &["physical.land-ice"],
        "climate",
        "metre",
        "IceThickness MaximumIceThickness",
    );
    group(
        &mut c,
        &["physical.land-ice"],
        "climate",
        "cubic-metre/year",
        "MaximumIceFlux MaximumGroundedIceFlux",
    );
    group(
        &mut c,
        &["physical.land-ice"],
        "climate",
        "category",
        "GroundedIce",
    );
    group(
        &mut c,
        &["physical.landforms"],
        "geology",
        "gradient",
        "Slope",
    );
    group(
        &mut c,
        &["physical.landforms"],
        "geology",
        "category",
        "LandformCodes FeatureFlags",
    );
    for channel in &mut c {
        if [
            "CrustSutureStrength",
            "StructuralGrainX",
            "StructuralGrainY",
            "ThrustAcross",
            "ThrustDip",
            "MaximumIceFlux",
            "MaximumGroundedIceFlux",
        ]
        .contains(&channel.name.as_str())
        {
            channel.discrete = true;
        }
        if [
            "SedimentThickness",
            "CumulativeFluvialErosion",
            "CumulativeGlacialErosion",
            "CumulativeCoastalErosion",
            "CumulativeDeposition",
            "CumulativeGlacialDeposition",
            "VolcanicConstructionHistory",
            "VolcanicMeltSupply",
            "LandmarkMaintenance",
            "ImpactExcavation",
            "ImpactRimUplift",
            "ImpactEjectaThickness",
            "MaximumIceFlux",
            "MaximumGroundedIceFlux",
        ]
        .contains(&channel.name.as_str())
        {
            channel.minimum = Some(0.0);
        }
    }
    c.extend(material());
    c.extend(humans());
    c
}
fn ecology(c: &mut Vec<Channel>) {
    let start = c.len();
    let owners = &["ecology.living"] as &'static [&'static str];
    group(c, owners, "ecology", "category", "BiomeCodes");
    // atlasSampling receives no explicit quantity for this source band, while putChannel
    // publishes its category unit as a categorical quantity.
    c.last_mut().unwrap().discrete = false;
    group(c, owners, "ecology", "ratio", "TreeCover GrassCover WetlandCover FireActivity BroadleafCover ConiferCover BroadleafSaplings ConiferSaplings GrassSeed BroadleafSeed ConiferSeed WetlandSeed EcologicalDamage EcologicalToxicity Infiltration");
    group(
        c,
        owners,
        "ecology",
        "kg-carbon/square-metre/year",
        "Productivity AquaticProductivity",
    );
    group(c, owners, "ecology", "kg-carbon/square-metre", "Herbivores Predators AquaticFauna SoilCarbon PeatCarbon AquaticCarbon BuriedPlantCarbon BuriedAquaticCarbon CoalCarbon OilCarbon GasCarbon Grazers Browsers MigrationFlux");
    group(
        c,
        owners,
        "ecology",
        "metre",
        "OrganicBurialDepth SoilDepth",
    );
    group(
        c,
        owners,
        "ecology",
        "million-year-equivalent",
        "OrganicMaturity",
    );
    group(
        c,
        owners,
        "ecology",
        "kg-nitrogen/square-metre",
        "MineralNutrients",
    );
    group(c, owners, "ecology", "per-year", "FloodFrequency");
    group(c, owners, "ecology", "year", "CanopyAge");
    group(c, owners, "ecology", "metre/year", "Evapotranspiration");
    for channel in &mut c[start..] {
        channel.minimum = Some(0.0);
        if channel.unit == "ratio" {
            channel.maximum = Some(1.0);
        }
    }
}
fn water(c: &mut Vec<Channel>) {
    let start = c.len();
    let routing = &["water.routing"] as &'static [&'static str];
    let ocean = &["ocean.geography"] as &'static [&'static str];
    group(c, routing, "rivers", "metre", "SnowPack GroundwaterStorage");
    group(
        c,
        &["water.routing", "ecology.living"],
        "ecology",
        "metre",
        "SoilWater",
    );
    group(
        c,
        ocean,
        "rivers",
        "native-length",
        "WaterDepths WaterSurfaceElevations",
    );
    group(c, ocean, "rivers", "category", "WaterKindCodes");
    group(c, routing, "rivers", "category", "WaterBodyIds");
    for month in 0..12 {
        c.push(Channel::new(
            format!("SurfaceWaterMonth{month}"),
            "millimetre",
            routing,
            "rivers",
        ));
    }
    group(
        c,
        routing,
        "rivers",
        "millimetre/year",
        "WaterRecharge SnowKept",
    );
    for channel in &mut c[start..] {
        if channel.unit != "category" && channel.name != "WaterSurfaceElevations" {
            channel.minimum = Some(0.0);
        }
    }
    group(c, routing, "rivers", "native-length", "DrainageElevations");
    group(c, routing, "rivers", "millimetre/year", "Runoff");
    group(c, routing, "rivers", "square-metre", "CatchmentArea");
    group(
        c,
        routing,
        "rivers",
        "cubic-metre/second",
        "FlowAccumulation",
    );
    group(c, routing, "rivers", "metre", "SmallChannelLength");
    c.last_mut().unwrap().quantity = Quantity::Extensive;
    group(c, routing, "rivers", "deci-celsius", "RiverWarmth");
    group(c, routing, "rivers", "category", "DrainageBasinIds");
    group(c, ocean, "rivers", "metre", "OceanDistance");
    group(c, ocean, "geology", "category", "BathymetricZoneCodes");
    let networks = &["physical.river-networks"] as &'static [&'static str];
    group(c, networks, "rivers", "metre", "RiverWidth RiverDepth");
    group(c, networks, "rivers", "per-mille", "RiverChannelStrength");
    group(c, networks, "rivers", "category", "RiverOrders");
    group(c, networks, "rivers", "cubic-metre/second", "PerennialFlow");
    c.last_mut().unwrap().minimum = Some(0.0);
    group(
        c,
        &["physical.floodplains"],
        "rivers",
        "per-mille",
        "FloodplainIntensity",
    );
    group(
        c,
        &["physical.deltas"],
        "rivers",
        "per-mille",
        "DeltaIntensity",
    );
    let circulation = &["physical.ocean-circulation"] as &'static [&'static str];
    group(
        c,
        circulation,
        "rivers",
        "per-mille",
        "WaveExposure OceanCurrentStrength Upwelling StormForcing",
    );
    group(
        c,
        circulation,
        "rivers",
        "deci-celsius",
        "SeaSurfaceAnomaly",
    );
    group(c, circulation, "climate", "per-mille", "OceanCurrentHeat");
    group(c, circulation, "climate", "deci-celsius", "Warmth");
}
pub fn material() -> Vec<Channel> {
    let mut c = Vec::new();
    for (column, prefix) in [
        (Column::Land, "RockLayer"),
        (Column::Cut, "RockCutLayer"),
        (Column::Loose, "LooseLayer"),
        (Column::CutLoose, "LooseCutLayer"),
    ] {
        for slot in 0..column.size() {
            material_slots(
                &mut c,
                |property| format!("{prefix}{property}{slot}"),
                false,
            );
        }
    }
    group(&mut c, FOUNDATION, "geology", "ratio", "GroundCutShare");
    group(
        &mut c,
        FOUNDATION,
        "geology",
        "native-length",
        "GroundCutDepth GroundCutCover",
    );
    for prefix in ["GroundLoad", "SeaLoad"] {
        material_slots(
            &mut c,
            |property| {
                format!(
                    "{prefix}{}",
                    if property == "Depth" {
                        "Volume"
                    } else {
                        property
                    }
                )
            },
            true,
        );
    }
    for channel in &mut c {
        channel.discrete = true;
    }
    group(
        &mut c,
        FOUNDATION,
        "geology",
        "native-length",
        "BedrockElevation CrustSupportElevation CrustThickness SurfaceRockLoad",
    );
    group(
        &mut c,
        FOUNDATION,
        "geology",
        "per-mille",
        "CrustContinentalFraction",
    );
    for channel in &mut c {
        channel.material = true;
        if channel.name == "GroundCutShare" {
            channel.minimum = Some(0.0);
            channel.maximum = Some(1.0);
        }
        if [
            "GroundCutCover",
            "CrustThickness",
            "CrustContinentalFraction",
        ]
        .contains(&channel.name.as_str())
        {
            channel.minimum = Some(0.0);
        }
    }
    c
}
fn material_slots(c: &mut Vec<Channel>, name: impl Fn(&str) -> String, load: bool) {
    for property in ["Kind", "SecondaryKind", "Mixed"] {
        c.push(Channel::new(
            name(property),
            "category",
            FOUNDATION,
            "geology",
        ));
    }
    for property in MaterialScalar::ALL {
        let unit = match property {
            MaterialScalar::Depth => {
                if load {
                    "cubic-metre"
                } else {
                    "native-length"
                }
            }
            MaterialScalar::FormedMin
            | MaterialScalar::FormedMax
            | MaterialScalar::Altered
            | MaterialScalar::Deposited => "epoch",
            MaterialScalar::Strength => "rock-strength",
            MaterialScalar::BedSlopeX | MaterialScalar::BedSlopeY => "gradient",
            _ => "ratio",
        };
        let mut channel = Channel::new(name(property.name()), unit, FOUNDATION, "geology");
        if matches!(property, MaterialScalar::Depth) {
            channel.minimum = Some(0.0);
            if load {
                channel.quantity = Quantity::Extensive;
            }
        }
        if matches!(property, MaterialScalar::SecondaryShare) {
            channel.minimum = Some(0.0);
            channel.maximum = Some(1.0);
        }
        c.push(channel);
    }
}
pub(super) fn humans() -> Vec<Channel> {
    let mut channels = Vec::new();
    let c = &mut channels;
    group(
        c,
        HUMANS,
        "cultures",
        "people/square-kilometre",
        "Population",
    );
    group(
        c,
        HUMANS,
        "cultures",
        "ratio",
        "Farmland Pasture BuiltUp RuinedBuiltUp RuinCover",
    );
    group(
        c,
        HUMANS,
        "cultures",
        "person-year/square-kilometre",
        "Standing RuinedStanding",
    );
    group(c, HUMANS, "cultures", "category", "RuinTongue");
    for slot in 0..IDENTITY_SLOTS {
        for (name, unit) in [
            ("People", "people/square-kilometre"),
            ("Hardness", "ratio"),
            ("Age", "year"),
            ("Tongue", "category"),
            ("Faith", "category"),
            ("Custom", "category"),
            ("Allegiance", "category"),
            ("Craft", "category"),
            ("Known", "category"),
        ] {
            c.push(Channel::new(
                format!("Identity{name}{slot}"),
                unit,
                HUMANS,
                "cultures",
            ));
        }
    }
    for channel in c {
        // Households travel with their donor's identity column. Land fractions and
        // invested capital describe spatial densities over the surrounding ground.
        channel.discrete = channel.quantity == Quantity::Category
            || channel.name == "Population"
            || channel.name.starts_with("Identity");
        if channel.quantity != Quantity::Category {
            channel.minimum = Some(0.0);
        }
        if channel.unit == "ratio" {
            channel.maximum = Some(1.0);
        }
    }
    channels
}
