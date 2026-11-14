//! Relative coefficient ownership from physicalProfileConfiguration.ts.
use super::error;
use crate::{atlas::features::Selection, parameters::Values};
use serde_json::Value;
use std::io;

pub fn keys(owner: &str) -> &'static [&'static str] {
    match owner {
        "physical.foundation" => &[
            "ContinentalAssemblyClustering",
            "ContinentalAssemblyGrowthVariation",
            "ContinentalMajorAssemblies",
            "ContinentalMajorGrowth",
            "ContinentalAssemblySeparationDepth",
            "ContinentalWarpStrength",
            "InteriorReliefStrength",
            "ElevationVariationStrength",
        ],
        "physical.tectonic-history" => &["EpochTectonicElevationStep"],
        "physical.mountains" => &["OrogenicInitialShortening"],
        "physical.river-incision" => &["FluvialEquilibriumGradient"],
        "material.fluvial-transport" => &["SedimentTransportFraction", "SedimentCarry"],
        "physical.coastal-construction" => &[
            "CoastalDetailStrength",
            "CoastalDetailScale",
            "CoastalDetailWarp",
            "CoastalDetailPassiveAmplitude",
            "CoastalDetailConvergentAmplitude",
            "CoastalDetailRiftedAmplitude",
            "CoastalDetailTransformAmplitude",
        ],
        "physical.coastal-evolution" => &["CoastalDepositionFraction", "CoastalDepositionReach"],
        "physical.glacial-sculpting" => &["IceAltitudeBalance"],
        "physical.volcanism" => &["MantlePlumeCount"],
        "physical.impacts" => &["ImpactPrimordialShare"],
        _ => &[],
    }
}
pub fn validate(owner: &str, configuration: &Values) -> io::Result<Values> {
    if configuration.keys().any(|key| key != "profile") {
        return Err(error(
            "feature_configuration",
            format!("{owner} owns only profile coefficients"),
        ));
    }
    let values = match configuration.get("profile") {
        None => Values::new(),
        Some(Value::Object(values)) => values.clone(),
        _ => {
            return Err(error(
                "feature_configuration",
                "Profile coefficients must be an object",
            ))
        }
    };
    for (key, value) in &values {
        let number = value
            .as_f64()
            .ok_or_else(|| error("feature_configuration", "Use a numeric coefficient"))?;
        if !keys(owner).contains(&key.as_str()) || !valid(key, number) {
            return Err(error(
                "feature_configuration",
                format!("Invalid {owner} coefficient {key}"),
            ));
        }
    }
    Ok(Values::from_iter([(
        "profile".into(),
        Value::Object(values),
    )]))
}
fn valid(key: &str, value: f64) -> bool {
    if !value.is_finite() || value < 0.0 {
        return false;
    }
    match key {
        "ContinentalAssemblyClustering"
        | "ContinentalAssemblyGrowthVariation"
        | "ContinentalAssemblySeparationDepth" => value <= 1.0,
        "ContinentalMajorAssemblies" | "MantlePlumeCount" => value.fract() == 0.0,
        "ContinentalMajorGrowth" | "CoastalDetailScale" => value > 0.0,
        "SedimentTransportFraction" | "CoastalDepositionFraction" | "ImpactPrimordialShare" => {
            value <= 1000.0
        }
        _ => true,
    }
}
pub fn overrides(selection: &Selection) -> Values {
    let mut result = Values::new();
    for feature in selection.values().filter(|feature| feature.enabled) {
        if let Some(Value::Object(profile)) = feature
            .configuration
            .as_ref()
            .and_then(|c| c.get("profile"))
        {
            result.extend(profile.clone());
        }
    }
    result
}
