//! Numeric controls from atlasParameters.ts, including their input bounds and defaults.
use serde::{Deserialize, Serialize};

macro_rules! parameters {
    ($($field:ident: ($default:expr, $min:expr, $max:expr, $integer:expr)),+ $(,)?) => {
        #[derive(Clone, Debug, Serialize, Deserialize)]
        #[serde(default, rename_all = "camelCase", deny_unknown_fields)]
        pub struct AtlasParameters { $(pub $field: f64,)+ }
        impl Default for AtlasParameters {
            fn default() -> Self { Self { $($field: $default,)+ } }
        }
        impl AtlasParameters {
            pub fn validate(&self) -> Result<(), &'static str> {
                $(if !self.$field.is_finite() || self.$field < $min || self.$field > $max
                    || ($integer && self.$field.fract() != 0.0) {
                    return Err(concat!("Invalid atlas parameter: ", stringify!($field)));
                })+
                if self.impact_size <= 0.0 { return Err("Impact size must be positive"); }
                if self.north_latitude < self.south_latitude {
                    return Err("The north edge cannot lie south of the south edge");
                }
                Ok(())
            }
        }
    };
}
parameters! {
    map_boundary: (1.0, 0.0, 2.0, true),
    continents: (3.0, 1.0, f64::INFINITY, true),
    oceanic_plates: (2.0, 0.0, f64::INFINITY, true),
    provinces: (42.0, 2.0, f64::INFINITY, true),
    continental_crust_fraction: (0.48, 0.0, 1.0, false),
    land_fraction: (0.38, 0.0, 1.0, false),
    temperature: (15.0, f64::NEG_INFINITY, f64::INFINITY, false),
    rainfall: (1.0, 0.0, f64::INFINITY, false),
    erosion: (1.0, 0.0, f64::INFINITY, false),
    sea_level: (0.0, f64::NEG_INFINITY, f64::INFINITY, false),
    south_latitude: (10.0, -90.0, 90.0, false),
    north_latitude: (70.0, -90.0, 90.0, false),
    latitude_projection: (1.0, 0.0, 1.0, true),
    impacts: (6.0, 0.0, f64::INFINITY, true),
    impact_size: (1.0, 0.0, f64::INFINITY, false),
    landscape_landmarks: (4.0, 0.0, f64::INFINITY, true),
    magic_landmarks: (3.0, 0.0, f64::INFINITY, true),
    volcanism: (1.0, 0.0, f64::INFINITY, false),
    plate_drift: (1.0, 0.0, f64::INFINITY, false),
    glaciers: (1.0, 0.0, f64::INFINITY, false),
    coastal_erosion: (1.0, 0.0, f64::INFINITY, false),
    vegetation: (1.0, 0.0, f64::INFINITY, false),
    grazing: (1.0, 0.0, f64::INFINITY, false),
    culture_count: (3.0, 1.0, f64::INFINITY, true),
    polity_count: (3.0, 1.0, f64::INFINITY, true),
    cultural_mobility: (1.0, 0.0, f64::INFINITY, false),
    political_reach: (1.0, 0.0, f64::INFINITY, false),
    town_threshold: (5000.0, 100.0, f64::INFINITY, true),
    city_reach: (0.05, 0.0025, f64::INFINITY, false),
    road_traffic: (1000.0, 50.0, f64::INFINITY, false),
    market_travel: (1.0, 0.0, f64::INFINITY, false),
    highways: (2.0, 0.0, f64::INFINITY, true),
}
