//! Current magicSystems.ts controls, resolved once through MapScale.
use crate::scale::{LengthUnit, MapScale, RelativeMeasure};
use serde::{Deserialize, Serialize};

macro_rules! parameters {
    ($($name:ident: ($default:expr, $dimension:expr, $minimum:expr, $maximum:expr, $positive:expr, $integer:expr)),+ $(,)?) => {
        #[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
        #[serde(default, rename_all = "camelCase", deny_unknown_fields)]
        #[ts(rename = "MagicParameters")]
        pub struct Parameters { $(pub $name: f64,)+ }
        impl Default for Parameters {
            fn default() -> Self { Self { $($name: $default,)+ } }
        }
        #[derive(Clone, Debug, Default, Serialize, Deserialize, ts_rs::TS)]
        #[serde(default, rename_all = "camelCase", deny_unknown_fields)]
        #[ts(rename = "MagicOverrides", optional_fields)]
        pub struct Overrides {
            $(#[serde(skip_serializing_if = "Option::is_none")] pub $name: Option<f64>,)+
        }
        impl Parameters {
            pub fn dimensions() -> serde_json::Value {
                #[derive(Serialize)]
                #[serde(rename_all = "camelCase")]
                struct Dimensions { $( $name: i32, )+ }
                serde_json::to_value(Dimensions { $( $name: $dimension, )+ })
                    .expect("Parameter dimensions are integers")
            }
            pub fn validate(&self) -> Result<(), &'static str> {
                $(if !self.$name.is_finite() || self.$name < $minimum || self.$name > $maximum
                    || ($positive && self.$name <= 0.0) || ($integer && self.$name.fract() != 0.0) {
                    return Err(concat!("Invalid magic parameter: ", stringify!($name)));
                })+
                Ok(())
            }
            pub(super) fn resolve(&mut self, scale: &MapScale) -> Result<(), &'static str> {
                $(if $dimension != 0 { self.$name = measure(scale, self.$name, $dimension)?; })+
                Ok(())
            }
            pub fn with_origin(&self, overrides: &Overrides) -> Self {
                Self { $($name: overrides.$name.unwrap_or(self.$name),)+ }
            }
        }
        impl Overrides {
            pub fn validate(&self) -> Result<(), &'static str> {
                $(if self.$name.is_some_and(|value| !value.is_finite()) {
                    return Err(concat!("Nonfinite origin override: ", stringify!($name)));
                })+
                Ok(())
            }
            pub(super) fn resolve(&mut self, scale: &MapScale) -> Result<(), &'static str> {
                $(if $dimension != 0 {
                    if let Some(value) = self.$name { self.$name = Some(measure(scale, value, $dimension)?); }
                })+
                Ok(())
            }
        }
    };
}
pub(super) fn measure(scale: &MapScale, value: f64, dimension: i32) -> Result<f64, &'static str> {
    Ok(scale
        .resolve(RelativeMeasure::new(
            value,
            dimension,
            1.0,
            LengthUnit::Metre,
        )?)?
        .value())
}
parameters! {
    source_threshold: (300.0, 0, f64::NEG_INFINITY, f64::INFINITY, false, false),
    source_spacing: (0.01125, 1, 0.0, f64::INFINITY, false, false),
    base_cost: (4.0, 0, 0.0, f64::INFINITY, true, false),
    conductance_divisor: (26.0, 0, 0.0, f64::INFINITY, true, false),
    base_input: (360.0, 0, 0.0, f64::INFINITY, false, false),
    log_scale: (66.0, 0, 0.0, f64::INFINITY, false, false),
    ice_retention: (0.0003, 1, 0.0, f64::INFINITY, true, false),
    cold_retention_distance: (0.0025, 1, 0.0, f64::INFINITY, true, false),
    accumulation_area: (0.00000625, 2, 0.0, f64::INFINITY, true, false),
    feature_noise_scale: (0.0175, 1, 0.0, f64::INFINITY, true, false),
    ray_count: (1200.0, 0, 0.0, f64::INFINITY, false, true),
    ray_distance: (1.1, 1, 0.0, f64::INFINITY, true, false),
    coastal_ray_distance: (0.325, 1, 0.0, f64::INFINITY, true, false),
    wake_distance: (0.475, 1, 0.0, f64::INFINITY, true, false),
    beam_width: (0.005, 1, 0.0, f64::INFINITY, true, false),
    coastal_sources: (200.0, 0, 0.0, f64::INFINITY, false, true),
    coastal_source_distance: (0.025, 1, 0.0, f64::INFINITY, true, false),
    wake_sources: (260.0, 0, 0.0, f64::INFINITY, false, true),
    coastal_threshold: (140.0, 0, 0.0, 999.0, false, false),
    wave_amplification: (0.36, 0, 0.0, f64::INFINITY, false, false),
    current_amplification: (0.18, 0, 0.0, f64::INFINITY, false, false),
    ray_decay: (3.0, 0, 0.0, f64::INFINITY, false, false),
    ray_intensity: (27.8, 0, 0.0, f64::INFINITY, false, false),
    wake_strength: (180.0, 0, 0.0, f64::INFINITY, false, false),
    conduit_budget: (2400.0, 0, 0.0, f64::INFINITY, true, false),
    fallen_density: (400_000_000.0, -1, 0.0, f64::INFINITY, false, false),
    fallen_release: (0.04, 0, 0.0, 1.0, false, false),
    strain_cracking: (0.3, 0, 0.0, f64::INFINITY, false, false),
    ice_cracking: (0.5, 0, 0.0, f64::INFINITY, false, false),
    ice_crack_depth: (0.000075, 1, 0.0, f64::INFINITY, true, false),
    frost_cracking: (0.05, 0, 0.0, f64::INFINITY, false, false),
    impact_shock: (0.3, 0, 0.0, 1.0, false, false),
    impact_heat_share: (0.6, 0, 0.0, 1.0, false, false),
    placer_mobility: (0.15, 0, 0.0, 1.0, false, false),
    bury_depth: (0.000005, 1, 0.0, f64::INFINITY, true, false),
    reopen_strain: (600.0, 0, 0.0, 1000.0, false, false),
    reopen_share: (0.4, 0, 0.0, 1.0, false, false),
    exhumed_release: (0.3, 0, 0.0, 1.0, false, false),
    fan_barren_epochs: (3.0, 0, 0.0, f64::INFINITY, false, false),
    fan_barren_depth: (0.0000005, 1, 0.0, f64::INFINITY, true, false),
    relict_strength: (0.5, 0, 0.0, 1.0, false, false),
    ice_carry: (0.8, 0, 0.0, 1.0, false, false),
    meltwater_loss: (0.2, 0, 0.0, 1.0, false, false),
    ice_charge_saturation: (8_000_000.0, -1, 0.0, f64::INFINITY, true, false),
    thaw_subsidence: (0.00000075, 1, 0.0, f64::INFINITY, false, false),
    shelf_saturation: (500.0, 0, 0.0, f64::INFINITY, true, false),
    storm_front_gradient: (30.0, 0, 0.0, f64::INFINITY, true, false),
    stand_age: (800.0, 0, 0.0, f64::INFINITY, false, false),
    stand_cover: (0.6, 0, 0.0, 1.0, false, false),
    peat_depth: (10.0, 0, 0.0, f64::INFINITY, false, false),
    root_cost: (6.0, 0, 0.0, f64::INFINITY, true, false),
    root_floor: (0.12, 0, 0.0, 1.0, false, false),
    spring_flow: (6.25e-19, 3, 0.0, f64::INFINITY, false, false),
    spring_charge_saturation: (4_000_000.0, -1, 0.0, f64::INFINITY, true, false),
    spring_rock: (700.0, 0, 0.0, f64::INFINITY, false, false),
    overdraw_share: (0.5, 0, 0.0, 1.0, false, false),
    sink_depth: (0.000001, 1, 0.0, f64::INFINITY, false, false),
    animal_carry: (0.02, 0, 0.0, 1.0, false, false),
    strata_share: (0.02, 0, 0.0, f64::INFINITY, false, false),
    organic_charge_affinity: (4.0, 0, 0.0, f64::INFINITY, true, false),
    grove_sap: (600.0, 0, 0.0, f64::INFINITY, true, false),
    sap_loss: (0.3, 0, 0.0, 1.0, false, false),
    forge_strength: (1000.0, 0, 0.0, f64::INFINITY, true, false),
    forge_cooling: (0.5, 0, 0.0, 1.0, false, false),
    salt_per_death: (0.0000003125, 2, 0.0, f64::INFINITY, false, false),
    salt_per_lake_metre: (160_000_000.0, -1, 0.0, f64::INFINITY, false, false),
    salt_full: (400.0, 0, 0.0, f64::INFINITY, true, false),
    salt_material_density: (8_000_000_000.0, -1, 0.0, f64::INFINITY, true, false),
    brine_flush: (0.6, 0, 0.0, 1.0, false, false),
    seep_share: (0.5, 0, 0.0, 1.0, false, false),
    crust_share: (0.5, 0, 0.0, 1.0, false, false),
    dissolve_share: (0.3, 0, 0.0, 1.0, false, false),
    dust_share: (0.15, 0, 0.0, 1.0, false, false),
    dust_settle: (0.5, 0, 0.0, 1.0, false, false),
    glass_bed: (800.0, 0, 0.0, f64::INFINITY, true, false),
    glass_resistance: (300.0, 0, 0.0, f64::INFINITY, false, false),
    desiccation: (0.5, 0, 0.0, 1.0, false, false),
    dome_strain: (600.0, 0, 0.0, 1000.0, false, false),
    dome_rise: (0.00000075, 1, 0.0, f64::INFINITY, false, false),
    dome_seep: (0.05, 0, 0.0, 1.0, false, false),
    salt_burn: (0.8, 0, 0.0, 1.0, false, false),
    tenure_full: (300_000_000.0, 0, 0.0, f64::INFINITY, true, false),
    pilgrimage_bonus: (0.1, 0, 0.0, f64::INFINITY, false, false),
    line_full: (10_000.0, 0, 0.0, f64::INFINITY, true, false),
    road_full: (10_000_000.0, 0, 0.0, f64::INFINITY, true, false),
    ward_reach: (0.01, 1, 0.0, f64::INFINITY, true, false),
    aurora_reinforce: (0.3, 0, 0.0, 1.0, false, false),
    ward_spill: (200.0, 0, 0.0, f64::INFINITY, false, false),
    tear_floor: (0.05, 0, 0.0, 1.0, false, false),
    tear_full: (0.4, 0, 0.0, 1.0, false, false),
    wild_shift: (0.3, 0, 0.0, 1.0, false, false),
    door_strain: (400.0, 0, 0.0, 1000.0, false, false),
    door_distance: (0.075, 1, 0.0, f64::INFINITY, true, false),
    door_match: (150.0, 0, 0.0, f64::INFINITY, false, false),
    wild_relief: (0.000005, 1, 0.0, f64::INFINITY, false, false),
    wild_shuffle: (0.3, 0, 0.0, 1.0, false, false),
    door_chill: (30.0, 0, 0.0, f64::INFINITY, false, false),
    door_pool: (0.00000075, 1, 0.0, f64::INFINITY, false, false),
    door_travel: (0.00125, 1, 0.0, f64::INFINITY, true, false),
    knit_verdure: (0.8, 0, 0.0, 1.0, false, false),
    hold_salting: (1.0, 0, 0.0, 1.0, false, false),
}
