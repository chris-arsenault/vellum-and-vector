//! The same plain process settings compose the world and regional physical profiles.
use crate::{
    field, processes,
    rock::catalogue,
    scale_settings::{RelativeOverrides, ScaleDefinition},
    tectonics,
};
use serde_json::{json, Value};
pub fn definition() -> ScaleDefinition {
    ScaleDefinition::combine([
        tectonics::initialization::settings(),
        tectonics::province_settings::settings(),
        field::crust_settings::settings(),
        field::sutures::settings(),
        field::coastal_detail::settings(),
        field::orogeny::settings::settings(),
        field::fractures::settings::settings(),
        field::impacts::settings::settings(),
        field::plumes::settings(),
        field::volcanism::settings::settings(),
        field::geography::settings(),
        field::climate::currents::settings::settings(),
        field::sea_ice::settings(),
        field::warmth::settings(),
        field::glaciers::settings(),
        field::landforms::settings(),
        field::water::drainage::settings(),
        field::water::channels::settings(),
        field::water::deltas::settings(),
        field::water::transfers::settings(),
        field::water::network::settings(),
        processes::streams::settings(),
        processes::fluvial::settings(),
        processes::coast::settings(),
        processes::slopes::settings(),
        processes::weathering::settings(),
        processes::creep::settings(),
        processes::solution::settings(),
        processes::marine_sediment::settings(),
        shared_settings(),
    ])
    .expect("Plain physical process settings")
}
fn shared_settings() -> ScaleDefinition {
    let measure = |fraction, dimension| json!({"kind":"relative-measure","fraction":fraction,"dimension":dimension,"exponent":1});
    let length = |fraction| measure(fraction, 1);
    ScaleDefinition::from_value(json!({"kind":"relative-settings","values":{
        "BoundaryPadding":length(0.025),"VolcanicRockResistance":catalogue::CATALOGUE[catalogue::BASALT].facts.resistance,
        "ElevationVariationScale":length(0.0625),"ElevationVariationStrength":0.12,"InteriorReliefStrength":0.2,"InteriorReliefScale":length(0.03),
        "ReliefSynthesisGain":2,"ReliefSynthesisFloor":length(0.000015),"ReliefSynthesisAnisotropy":3,"RegionalReliefMinimumSlope":0.008,
        "OrogenicCoreRockResistance":catalogue::CATALOGUE[catalogue::GNEISS].facts.resistance,
        "InteriorBasinDepthShare":260,"EpochTectonicElevationStep":length(0.00006),"ImpactVisibleRelief":length(0.000025),
        "GlacialAblationRunoffStrength":460,"BasalMeltRunoffStrength":180,"GlacialRetreatRunoffStrength":260,
        "SeaLevel":length(0.0),"WorldRiverMinimumBasinDischarge":measure(5.46875e-18,3),"MapBoundary":0,
        "StormScour":0.3,"DuneMobility":0.3,"WarmRiverEvaporation":0.3,"HillElevation":length(0.000125),
        "MountainLocalRelief":length(0.000075),"ReliefRadius":length(0.00375),"RangeMinimumArea":measure(0.000125,2),
        "CliffSlopeThreshold":0.012,"ChargedIceErosion":600,
        "QualityTargets":{"OceanCoverage":{"target":0.55,"minimum":0.38,"maximum":0.66},"InlandLakeBodyCount":{"minimum":2,"maximum":80}}
    }})).expect("Declared shared physical settings")
}
pub const OWNERS: &[(&str, &[&str])] = &[
    (
        "physical.foundation",
        &[
            "ContinentalAssemblyClustering",
            "ContinentalAssemblyGrowthVariation",
            "ContinentalMajorAssemblies",
            "ContinentalMajorGrowth",
            "ContinentalAssemblySeparationDepth",
            "ContinentalWarpStrength",
            "InteriorReliefStrength",
            "ElevationVariationStrength",
        ],
    ),
    ("physical.tectonic-history", &["EpochTectonicElevationStep"]),
    ("physical.mountains", &["OrogenicInitialShortening"]),
    ("physical.river-incision", &["FluvialEquilibriumGradient"]),
    (
        "material.fluvial-transport",
        &["SedimentTransportFraction", "SedimentCarry"],
    ),
    (
        "physical.coastal-construction",
        &[
            "CoastalDetailStrength",
            "CoastalDetailScale",
            "CoastalDetailWarp",
            "CoastalDetailPassiveAmplitude",
            "CoastalDetailConvergentAmplitude",
            "CoastalDetailRiftedAmplitude",
            "CoastalDetailTransformAmplitude",
        ],
    ),
    (
        "physical.coastal-evolution",
        &["CoastalDepositionFraction", "CoastalDepositionReach"],
    ),
    ("physical.glacial-sculpting", &["IceAltitudeBalance"]),
    ("physical.volcanism", &["MantlePlumeCount"]),
    ("physical.impacts", &["ImpactPrimordialShare"]),
];
pub struct Selection {
    pub id: String,
    pub enabled: bool,
    pub profile: Value,
}
fn valid(key: &str, value: f64) -> bool {
    if !value.is_finite() {
        return false;
    }
    match key {
        "ContinentalAssemblyClustering"
        | "ContinentalAssemblyGrowthVariation"
        | "ContinentalAssemblySeparationDepth" => (0.0..=1.0).contains(&value),
        "ContinentalMajorAssemblies" | "MantlePlumeCount" => value >= 0.0 && value.fract() == 0.0,
        "ContinentalMajorGrowth" | "CoastalDetailScale" => value > 0.0,
        "SedimentTransportFraction" | "CoastalDepositionFraction" | "ImpactPrimordialShare" => {
            (0.0..=1000.0).contains(&value)
        }
        _ => value >= 0.0,
    }
}
pub fn configured(features: &[Selection]) -> Result<RelativeOverrides, String> {
    let mut values = serde_json::Map::new();
    for (id, keys) in OWNERS {
        let Some(feature) = features.iter().find(|f| f.enabled && f.id == *id) else {
            continue;
        };
        let profile = feature
            .profile
            .as_object()
            .ok_or_else(|| format!("{id} needs profile settings"))?;
        for (key, value) in profile {
            if !keys.contains(&key.as_str()) || !value.as_f64().is_some_and(|v| valid(key, v)) {
                return Err(format!("Invalid {id} coefficient {key}"));
            }
            let value = if matches!(
                key.as_str(),
                "ContinentalMajorAssemblies" | "MantlePlumeCount"
            ) {
                let count = format!("{:.0}", value.as_f64().expect("validated count"))
                    .parse::<u64>()
                    .map_err(|_| format!("{key} exceeds count representation"))?;
                Value::from(count)
            } else {
                value.clone()
            };
            values.insert(key.clone(), value);
        }
    }
    Ok(RelativeOverrides::from_value(Value::Object(values)))
}
