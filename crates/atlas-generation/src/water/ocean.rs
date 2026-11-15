//! Ocean connectivity separates the formation budget, current surface and basin memory.
use super::{
    column::{StandingKind, Store, WaterColumn},
    ocean_components::{ocean_seeds, visit_connected, OceanComponents},
};
use crate::{
    hpc::Direction,
    lattice::TriangularLattice,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, Coverage, ReadBand},
};
use std::io;

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct OceanDatum {
    pub base_level: f64,
    pub base_volume: f64,
    pub initialized: bool,
    pub effective_level: f64,
}
pub struct OceanInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub elevation: &'a ReadBand<f64>,
    pub scale: &'a MapScale,
    pub grounded_ice: &'a ReadBand<u8>,
    pub ice_thickness: &'a ReadBand<f64>,
}
pub struct FormationBudget {
    pub crust_forming: bool,
    pub completed_epochs: usize,
    pub coverage: f64,
    pub sea_level: f64,
    pub elevation_scale: f64,
}
/// A surface refresh releases the owner borrow before coupled sea-stand answers are evaluated.
pub struct SurfaceRefresh {
    previous_surface: Band<f64>,
    marine: Band<u8>,
    previous: Band<f64>,
}
impl OceanInputs<'_> {
    fn margin(&self) -> io::Result<f64> {
        Ok(MapScale::native(
            self.scale
                .resolve(RelativeMeasure::length(2.5e-7).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
                .value(),
        ))
    }
    fn lowest_boundary(&self) -> io::Result<f64> {
        let mut lowest = f64::MAX;
        for cell in ocean_seeds(self.mesh, self.elevation)? {
            lowest = lowest.min(self.elevation.get(cell)?);
        }
        Ok(lowest)
    }
    pub fn grounded_ice_water(&self) -> io::Result<f64> {
        let mut volume = 0.0;
        for cell in 0..self.mesh.len() {
            if self.grounded_ice.get(cell)? != 0 {
                volume += self.ice_thickness.get(cell)? * self.mesh.content_area(cell) * 0.917;
            }
        }
        Ok(volume)
    }
    pub fn connected_volume(&self, level: f64, coverage: &mut Coverage) -> io::Result<f64> {
        let mut volume = 0.0;
        visit_connected(self.mesh, self.elevation, level, coverage, |cell| {
            volume += MapScale::metres(level - self.elevation.get(cell)?, LengthUnit::Native)
                * self.mesh.content_area(cell);
            Ok(())
        })?;
        Ok(volume)
    }
    fn level_for_volume(&self, volume: f64, coverage: &mut Coverage) -> io::Result<f64> {
        let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
        for cell in 0..self.mesh.len() {
            let value = self.elevation.get(cell)?;
            low = low.min(value);
            high = high.max(value);
        }
        high += self.margin()?;
        while high - low > 1.0 {
            let middle = low + (high - low) / 2.0;
            if self.connected_volume(middle, coverage)? < volume {
                low = middle;
            } else {
                high = middle;
            }
        }
        Ok(high)
    }
    fn connected_level(&self, target: f64, coverage: &mut Coverage) -> io::Result<f64> {
        let mut components = OceanComponents::new(self.mesh, self.elevation, coverage)?;
        let mut level = Vec::new();
        let mut elevation = f64::NEG_INFINITY;
        for cell in coverage.order(self.elevation, Direction::Ascending)? {
            let cell = cell?;
            let height = self.elevation.get(cell)?;
            if height != elevation {
                for cell in level.drain(..) {
                    components.connect(self.mesh, cell)?;
                }
                if components.connected >= target {
                    return Ok(elevation + self.margin()?);
                }
                elevation = height;
            }
            components.activate(self.mesh, cell)?;
            level.push(cell);
        }
        for cell in level {
            components.connect(self.mesh, cell)?;
        }
        Ok(elevation + self.margin()?)
    }
}
impl OceanDatum {
    pub fn initialize_budget(
        &mut self,
        input: &OceanInputs<'_>,
        formation: FormationBudget,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let owned = !self.initialized || self.base_volume > 0.0;
        if owned && formation.crust_forming && formation.completed_epochs == 0 {
            let area: f64 = (0..input.mesh.len())
                .map(|cell| input.mesh.content_area(cell))
                .sum();
            self.base_level = (input.connected_level(area * formation.coverage, coverage)?
                + MapScale::native(formation.sea_level * formation.elevation_scale))
            .max(input.lowest_boundary()? + input.margin()?);
            self.base_volume =
                input.connected_volume(self.base_level, coverage)? + input.grounded_ice_water()?;
            self.initialized = true;
        }
        Ok(())
    }
    pub fn surface(
        &mut self,
        input: &OceanInputs<'_>,
        offset: f64,
        water: &mut WaterColumn,
        stand: &dyn Fn(usize, f64) -> io::Result<f64>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let previous = self.prepare_surface(input, offset, water, coverage)?;
        self.finish_surface(input, water, stand, previous, coverage)
    }
    pub fn prepare_surface(
        &mut self,
        input: &OceanInputs<'_>,
        offset: f64,
        water: &mut WaterColumn,
        coverage: &mut Coverage,
    ) -> io::Result<SurfaceRefresh> {
        let mut previous_surface = coverage.scratch(input.mesh.len(), 0.0);
        let mut marine = coverage.scratch(input.mesh.len(), 0u8);
        let mut previous = coverage.scratch(input.mesh.len(), 0.0);
        let view = water.read_only();
        for cell in 0..input.mesh.len() {
            previous_surface.set(cell, view.surface.get(cell)?)?;
            marine.set(cell, u8::from(view.kind.get(cell)? == 1))?;
            previous.set(
                cell,
                if view.kind.get(cell)? > 0 {
                    MapScale::native(view.store(Store::Standing).held(cell)?)
                } else {
                    0.0
                },
            )?;
        }
        water.clear_standing()?;
        if self.base_volume > 0.0 {
            self.base_level = input
                .level_for_volume(
                    (self.base_volume - input.grounded_ice_water()?).max(0.0),
                    coverage,
                )?
                .max(input.lowest_boundary()? + input.margin()?);
        }
        self.effective_level = self.base_level + MapScale::native(offset);
        Ok(SurfaceRefresh {
            previous_surface,
            marine,
            previous,
        })
    }
    pub fn finish_surface(
        &self,
        input: &OceanInputs<'_>,
        water: &mut WaterColumn,
        stand: &dyn Fn(usize, f64) -> io::Result<f64>,
        previous: SurfaceRefresh,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let SurfaceRefresh {
            previous_surface,
            marine,
            previous,
        } = previous;
        let view = water.read_only();
        visit_connected(
            input.mesh,
            input.elevation,
            self.effective_level,
            coverage,
            |cell| {
                if input.elevation.get(cell)? < stand(cell, self.effective_level)? {
                    water.stand(cell, StandingKind::Sea, self.effective_level, Some(1))?;
                }
                Ok(())
            },
        )?;
        for cell in 0..input.mesh.len() {
            let depth = enclosed_water_depth(
                previous.get(cell)?,
                previous_surface.get(cell)?,
                input.elevation.get(cell)?,
                stand(cell, self.effective_level)?,
                view.kind.get(cell)? == 1,
                marine.get(cell)? != 0,
            );
            if depth > 0.0 {
                water.stand(
                    cell,
                    StandingKind::Lake,
                    input.elevation.get(cell)? + depth,
                    None,
                )?;
            }
        }
        Ok(())
    }
}
pub fn enclosed_water_depth(
    previous_depth: f64,
    previous_surface: f64,
    ground: f64,
    sea_level: f64,
    connected: bool,
    marine: bool,
) -> f64 {
    if connected || (marine && ground >= sea_level) {
        0.0
    } else {
        previous_depth.min(previous_surface - ground).max(0.0)
    }
}
impl WaterColumn {
    pub fn record_marine_connections(&mut self) -> io::Result<()> {
        let view = self.read_only();
        for cell in 0..view.kind.len() {
            if view.kind.get(cell)? == 1 {
                self.forget_lake(cell)?;
            }
        }
        Ok(())
    }
}
