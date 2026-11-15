//! Fixed physical detail levels shared by both execution hosts.
use crate::scale::{AreaUnit, MapScale};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Draft,
    Standard,
    Fine,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    World,
    Region,
    Local,
    Site,
    Interior,
}
impl Quality {
    // owner-direction(2026-11-12): the resolutions are fixed; a detail level is not a cell count.
    pub fn cell_area_km2(self, profile: Profile) -> f64 {
        let world = match self {
            Self::Draft => 800.0,
            Self::Standard => 200.0,
            Self::Fine => 50.0,
        };
        world
            * match profile {
                Profile::World => 1.0,
                Profile::Region => 0.01,
                Profile::Local => 0.0001,
                Profile::Site => 0.000001,
                Profile::Interior => 0.00000001,
            }
    }
    pub fn cell_span(self, profile: Profile) -> f64 {
        MapScale::area_units(
            self.cell_area_km2(profile),
            AreaUnit::SquareKilometre,
            AreaUnit::SquareMetre,
        )
        .sqrt()
    }
    // owner-direction(2026-11-12): a standard region has roughly the cells of the default standard world, at 7-ish land regions in a world.
    pub fn regional_span(self, level: u32) -> Result<f64, &'static str> {
        if level == 0 {
            return Err("Choose a positive regional scale level");
        }
        let detail = match self {
            Self::Draft => 4.0,
            Self::Standard => 1.0,
            Self::Fine => 0.25,
        };
        let standard_area = MapScale::REFERENCE_WIDTH * MapScale::REFERENCE_HEIGHT * 0.35
            / 7.0_f64.powf(f64::from(level))
            / 60_000.0;
        let span = (standard_area * detail).sqrt();
        if span.is_finite() && span > 0.0 {
            Ok(span)
        } else {
            Err("Regional scale exceeds numeric representation")
        }
    }
}
