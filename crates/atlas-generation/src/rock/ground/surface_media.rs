use super::{Ground, GroundField};
use crate::{
    scale::{LengthUnit, MapScale},
    settlement::stage::Pool,
};
use std::io;
impl Ground {
    pub(crate) fn record_ice_melt(&mut self, cause: &str, volume: f64) {
        self.record_flow(cause, Pool::Ice, Pool::Melt, volume);
    }
    pub fn spoil_soil(&mut self, cell: usize, share: f64, cause: &str) -> io::Result<()> {
        let before = self.get(GroundField::SoilDepth, cell)?;
        let lost = before * share.clamp(0.0, 1.0);
        if lost <= 0.0 {
            return Ok(());
        }
        self.set(GroundField::SoilDepth, cell, before - lost)?;
        self.record_flow(
            cause,
            Pool::Soil,
            Pool::Loose,
            MapScale::metres(MapScale::native(lost), LengthUnit::Native) * self.mesh.area(cell),
        );
        Ok(())
    }
}
