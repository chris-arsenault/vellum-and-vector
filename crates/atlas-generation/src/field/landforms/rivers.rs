use super::Landscape;
use crate::{
    scale::{LengthUnit, MapScale},
    water::{column::NO_WATER_SURFACE, network::RiverSample},
};
use std::io;
impl Landscape<'_> {
    pub fn on_river(&self, cell: usize) -> io::Result<bool> {
        Ok(self
            .rivers
            .order_at(cell, self.water.column.kind.get(cell)?)
            > 0)
    }
    fn river_level(&self, cell: usize) -> io::Result<f64> {
        let kind = self.water.column.kind.get(cell)?;
        let ground = self.elevation.get(cell)?;
        if kind == 0 {
            return Ok(self.rivers.sample(cell, RiverSample::Bed, ground));
        }
        if kind == 1 {
            return Ok(ground.max(self.water.effective_sea_level));
        }
        let surface = self.water.column.surface.get(cell)?;
        Ok(if surface == NO_WATER_SURFACE {
            ground
        } else {
            ground.max(surface)
        })
    }
    pub fn river_drop(&self, cell: usize) -> io::Result<f64> {
        match self.successor(cell)? {
            Some(next) => Ok(MapScale::metres(
                self.river_level(cell)? - self.river_level(next)?,
                LengthUnit::Native,
            )),
            None => Ok(0.0),
        }
    }
    pub fn river_gradient(&self, cell: usize) -> io::Result<f64> {
        match self.successor(cell)? {
            Some(next) => {
                Ok(self.river_drop(cell)? / self.field.mesh.physical_distance(cell, next))
            }
            None => Ok(0.0),
        }
    }
    fn gradient_above(&self, cell: usize) -> io::Result<f64> {
        let mut above = 0.0f64;
        for edge in 0..3 {
            let Some(next) = self.field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if self.on_river(next)? && self.successor(next)? == Some(cell) {
                above = above.max(self.river_gradient(next)?);
            }
        }
        Ok(above)
    }
    pub fn is_river_step(&self, cell: usize) -> io::Result<bool> {
        if self.water.column.kind.get(cell)? != 0
            || !self.on_river(cell)?
            || self.river_drop(cell)? < super::length(self.field, 0.0000025)?
        {
            return Ok(false);
        }
        let below = match self.successor(cell)? {
            Some(next) => self.river_gradient(next)?.max(0.0),
            None => 0.0,
        };
        Ok(self.river_gradient(cell)? >= 5.0 * self.gradient_above(cell)?.max(below))
    }
}
