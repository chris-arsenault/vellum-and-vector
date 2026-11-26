use crate::atlas::resolution::{HexSize, Profile, Quality};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub enum MapType {
    World,
    Region,
    City,
    Street,
}

impl MapType {
    pub const WORLD: &[Self] = &[Self::World];
    pub const REGIONAL: &[Self] = &[Self::Region, Self::City];
    pub const STREET: &[Self] = &[Self::Street];
    pub const REFINED: &[Self] = &[Self::Region, Self::City, Self::Street];
    pub const ALL: &[Self] = &[Self::World, Self::Region, Self::City, Self::Street];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
pub enum Timing {
    Elapsed,
    Present,
}

/// How the selected algorithm affects the map's time, independent of its caller's clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
pub enum EffectTime {
    Elapsed,
    SpatialIteration,
    Present,
    Event,
}

impl EffectTime {
    pub fn clock(self) -> Timing {
        match self {
            Self::Elapsed | Self::Event => Timing::Elapsed,
            Self::Present | Self::SpatialIteration => Timing::Present,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Site {
    pub map_type: MapType,
    pub cell_metres: f64,
}

/// Both bounds are in metres. The lower bound is exclusive and the upper is inclusive.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resolution {
    pub above_metres: f64,
    pub through_metres: f64,
}

impl Resolution {
    /// These people processes work at every supported finite cell size.
    pub const POSITIVE: Self = Self {
        above_metres: 0.0,
        through_metres: f64::MAX,
    };
}

/// These bands use the configured area-equivalent cell span in metres. They are
/// independent of the type of map that a rule allows.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub enum ScaleBand {
    World,
    Regional,
    Street,
    #[serde(untagged)]
    Metric(Resolution),
}

impl ScaleBand {
    pub fn endpoints(self) -> (f64, f64, bool) {
        match self {
            Self::Metric(range) => (range.above_metres, range.through_metres, false),
            Self::World => (
                Quality::Fine
                    .cell_span(Profile::World)
                    .expect("world detail"),
                Quality::Draft
                    .cell_span(Profile::World)
                    .expect("world detail"),
                true,
            ),
            Self::Regional => (
                0.0,
                Quality::Draft
                    .regional_span(1)
                    .expect("first regional level"),
                false,
            ),
            Self::Street => (
                Quality::Fine.real_scale_span(HexSize::OneAndHalfMetres),
                Quality::Draft.real_scale_span(HexSize::ThreeHundredMetres),
                true,
            ),
        }
    }

    pub(crate) fn contains(self, metres: f64) -> bool {
        let (lower, upper, closed) = self.endpoints();
        (lower < metres || (closed && lower == metres)) && metres <= upper
    }
}
