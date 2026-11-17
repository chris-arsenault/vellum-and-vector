use crate::{
    field::schema::NumericBand,
    reconstruction::Grid,
    storage::{Coverage, ReadBand},
};
// hpc-exempt: resource metadata indexed by channel name.
use std::{collections::BTreeMap, rc::Rc};

#[derive(Clone)]
pub struct Channel {
    pub values: NumericBand,
    pub unit: String,
    pub quantity: crate::field::projection::channels::Quantity,
}

#[derive(Clone)]
pub struct Cargo {
    pub keys: Vec<String>,
    pub released_to: Vec<String>,
    pub slots: Vec<String>,
    pub offsets: ReadBand<u32>,
    pub records: ReadBand<f64>,
}
#[derive(Clone)]
pub struct Resource {
    pub grid: Rc<Grid>,
    pub resolution: Option<f64>,
    pub active: ReadBand<u8>,
    // hpc-exempt: current-format resource channel names; values retain typed storage.
    pub channels: BTreeMap<String, Channel>,
    pub cargo: Option<Cargo>,
    pub surface_support: Option<crate::field::projection::support::ReadSupport>,
    pub overlays: Vec<Overlay>,
    _coverage: Rc<Coverage>,
}
/// Captured current-format patches retain their source resources and channel scope.
#[derive(Clone)]
pub struct Overlay {
    pub footprint: atlas_map::Geometry,
    pub channels: Vec<String>,
    pub resource: Rc<Resource>,
}
impl Resource {
    // hpc-exempt: channel metadata; coverage keeps all captured bands alive.
    pub fn new(
        grid: Rc<Grid>,
        active: ReadBand<u8>,
        // hpc-exempt: channel names refer to typed resource bands.
        channels: BTreeMap<String, Channel>,
        cargo: Option<Cargo>,
        coverage: Coverage,
    ) -> Self {
        Self {
            grid,
            resolution: None,
            active,
            channels,
            cargo,
            surface_support: None,
            overlays: Vec::new(),
            _coverage: Rc::new(coverage),
        }
    }
    /// A captured map selects a chart without changing or copying its pinned resource bytes.
    pub fn in_chart(&self, periodic_width: Option<f64>) -> Self {
        let mut grid = (*self.grid).clone();
        grid.periodic_width = periodic_width;
        Self {
            grid: Rc::new(grid),
            overlays: self
                .overlays
                .iter()
                .map(|overlay| Overlay {
                    footprint: overlay.footprint.clone(),
                    channels: overlay.channels.clone(),
                    resource: Rc::new(overlay.resource.in_chart(periodic_width)),
                })
                .collect(),
            ..self.clone()
        }
    }
}
