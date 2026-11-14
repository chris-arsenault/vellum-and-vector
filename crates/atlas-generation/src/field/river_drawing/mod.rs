//! Continuous river drawings and longitudinal profiles from the retained water owner.
mod curves;
mod floodplain;
pub mod meanders;
mod paths;
use atlas_map::Position;
pub use floodplain::{meander, Meandered};
pub use paths::{Paths, WaterShapes};
// hpc-exempt: named profile channels, each containing a typed numerical vector.
use std::collections::BTreeMap;
pub type Point = [f64; 2];
pub struct Drawing {
    pub coordinates: Vec<Position>,
    // hpc-exempt: profile channel names, not geographic cell storage.
    pub profiles: BTreeMap<String, Vec<f64>>,
}
impl super::Field {
    pub fn has_retained_river(&self, cell: usize) -> bool {
        self.water.borrow().river_reader().at(cell).is_some()
    }
    pub fn retained_reaches(&self) -> Vec<crate::water::reaches::Reach> {
        self.water.borrow().rivers().reaches().cloned().collect()
    }
    pub fn river_at(&self, cell: usize) -> Option<crate::water::reaches::Reach> {
        self.water.borrow().river_reader().at(cell).cloned()
    }
    pub fn river_months(&self, cell: usize) -> f64 {
        self.water.borrow().river_reader().sample(
            cell,
            crate::water::network::RiverSample::Months,
            0.0,
        )
    }
}
