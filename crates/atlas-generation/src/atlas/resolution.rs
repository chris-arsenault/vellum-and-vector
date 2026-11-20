//! Fixed physical detail levels shared by both execution hosts.
use crate::{
    lattice::TRIANGLE_AREA,
    scale::{AreaUnit, MapScale},
};
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
impl Profile {
    /// Real-scale maps take their cell size from a chosen hex size, not from a fixed area.
    pub fn real_scale(self) -> bool {
        matches!(self, Self::Local | Self::Site | Self::Interior)
    }
}
/// The hex sizes a real-scale map can be drawn at, measured across flats.
// owner-direction(2026-11-16): replace the previous real scale resolutions with the updated list
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize, ts_rs::TS)]
pub enum HexSize {
    #[serde(rename = "1.5m")]
    OneAndHalfMetres,
    #[serde(rename = "3m")]
    ThreeMetres,
    #[serde(rename = "10m")]
    TenMetres,
    #[serde(rename = "30m")]
    ThirtyMetres,
    #[serde(rename = "100m")]
    HundredMetres,
    #[serde(rename = "300m")]
    ThreeHundredMetres,
}
impl HexSize {
    pub const ALL: [Self; 6] = [
        Self::OneAndHalfMetres,
        Self::ThreeMetres,
        Self::TenMetres,
        Self::ThirtyMetres,
        Self::HundredMetres,
        Self::ThreeHundredMetres,
    ];
    pub fn across_flats(self) -> f64 {
        match self {
            Self::OneAndHalfMetres => 1.5,
            Self::ThreeMetres => 3.0,
            Self::TenMetres => 10.0,
            Self::ThirtyMetres => 30.0,
            Self::HundredMetres => 100.0,
            Self::ThreeHundredMetres => 300.0,
        }
    }
    /// The familiar tabletop size in feet, for display beside the metres.
    pub fn feet(self) -> f64 {
        match self {
            Self::OneAndHalfMetres => 5.0,
            Self::ThreeMetres => 10.0,
            Self::TenMetres => 30.0,
            Self::ThirtyMetres => 100.0,
            Self::HundredMetres => 330.0,
            Self::ThreeHundredMetres => 1000.0,
        }
    }
}
/// The lattice cell span when `edges` triangle edges make one side of a `hex`.
pub fn real_scale_span(hex: HexSize, edges: u32) -> f64 {
    // A hex of side s spans s√3 across flats; its triangles have side s/n and their
    // centres sit side/√3 apart, so the centre spacing is across-flats / 3n.
    let spacing = hex.across_flats() / (3.0 * f64::from(edges.max(1)));
    TRIANGLE_AREA.sqrt() * spacing
}
impl HexSize {
    pub fn label(self) -> &'static str {
        match self {
            Self::OneAndHalfMetres => "1.5m",
            Self::ThreeMetres => "3m",
            Self::TenMetres => "10m",
            Self::ThirtyMetres => "30m",
            Self::HundredMetres => "100m",
            Self::ThreeHundredMetres => "300m",
        }
    }
}
impl Quality {
    // owner-direction(2026-11-12): the resolutions are fixed; a detail level is not a cell count.
    pub fn cell_area_km2(self, profile: Profile) -> Result<f64, &'static str> {
        let world = match self {
            Self::Draft => 800.0,
            Self::Standard => 200.0,
            Self::Fine => 50.0,
        };
        match profile {
            Profile::World => Ok(world),
            Profile::Region => Ok(world * 0.01),
            _ => Err("A real-scale map takes its cell size from its hex size"),
        }
    }
    pub fn cell_span(self, profile: Profile) -> Result<f64, &'static str> {
        Ok(MapScale::area_units(
            self.cell_area_km2(profile)?,
            AreaUnit::SquareKilometre,
            AreaUnit::SquareMetre,
        )
        .sqrt())
    }
    /// How many triangle edges make one side of a hex. A hex holds six times its square.
    pub fn triangles_per_hex_edge(self) -> u32 {
        match self {
            Self::Draft => 1,
            Self::Standard => 2,
            Self::Fine => 3,
        }
    }
    /// The shared triangular lattice's cell span for a real-scale map at this hex size.
    // owner-direction(2026-11-16): no hex lattice; the hex is a representation for resolution built from a triangle sub-lattice
    pub fn real_scale_span(self, hex: HexSize) -> f64 {
        real_scale_span(hex, self.triangles_per_hex_edge())
    }
    /// The regional level whose cells give an extent of this many square metres about a
    /// standard region's triangle count: each level holds a seventh of the one above it.
    pub fn level_for_extent(area: f64) -> u32 {
        let reference = MapScale::REFERENCE_WIDTH * MapScale::REFERENCE_HEIGHT * 0.35;
        ((reference / area.max(1.)).ln() / 7f64.ln())
            .round()
            .max(1.) as u32
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
