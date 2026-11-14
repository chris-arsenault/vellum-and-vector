use super::column::{Store, WaterColumn};
use crate::scale::{LengthUnit, MapScale};
use std::io;
pub fn capacity(depth: f64, carbon: f64) -> f64 {
    depth * (0.12 + (carbon / 30.0).min(1.0) * 0.15)
}
pub fn filled(held: f64, capacity: f64) -> f64 {
    if capacity > 0.0 {
        (held / capacity).min(1.0)
    } else {
        0.0
    }
}
impl WaterColumn {
    pub fn hold_soil(
        &mut self,
        cell: usize,
        millimetres: f64,
        wetting: f64,
        held: f64,
    ) -> io::Result<()> {
        self.put_soil_water(
            cell,
            held.max(MapScale::metres(millimetres, LengthUnit::Millimetre) + wetting),
        )
    }
    pub fn lose_soil(&mut self, cell: usize, share: f64) -> io::Result<()> {
        let held = self.store(Store::Soil).at(cell)?.held;
        self.put_soil_water(cell, held * (1.0 - share.clamp(0.0, 1.0)))
    }
}
