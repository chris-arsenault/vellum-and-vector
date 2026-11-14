//! Retained rivers consume the routed year directly from spillable bands.
use super::{
    evolution::{refresh_reach_water, RiverEnvironment},
    network::RiverSizes,
    reaches::ReachStore,
    year_routing::{channel_origins, RoutedYear},
};
use crate::{
    lattice::TriangularLattice,
    scale::MapScale,
    storage::{Coverage, ReadBand},
};
use std::io;
pub struct NetworkInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub water_kind: &'a ReadBand<u8>,
    pub targets: &'a ReadBand<i32>,
    pub catchment: &'a ReadBand<f64>,
    pub bed: &'a dyn Fn(usize) -> io::Result<f64>,
    pub scale: &'a MapScale,
    pub epoch: f64,
}
struct RoutedEnvironment<'a> {
    input: NetworkInputs<'a>,
    year: &'a RoutedYear,
    sizes: RiverSizes,
    forced: Vec<u8>,
    origins: Option<Vec<u8>>,
}
impl ReachStore {
    pub fn refresh_routed(
        &mut self,
        input: NetworkInputs<'_>,
        year: &RoutedYear,
    ) -> io::Result<()> {
        let sizes = RiverSizes::at(input.scale).map_err(io::Error::other)?;
        let env = RoutedEnvironment {
            input,
            year,
            sizes,
            forced: Vec::new(),
            origins: None,
        };
        for reach in self.records_mut().iter_mut().flatten() {
            refresh_reach_water(reach, &env)?;
        }
        Ok(())
    }
    /// An explicit occurrence alone evolves courses and dry history. Identity establishment follows it.
    pub fn advance_routed(
        &mut self,
        input: NetworkInputs<'_>,
        year: &RoutedYear,
        channel_length: Option<&ReadBand<f64>>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let sizes = RiverSizes::at(input.scale).map_err(io::Error::other)?;
        let mut forced = vec![0; input.mesh.len()];
        for reach in self.reaches().filter(|reach| reach.river.is_some()) {
            let mut cell = reach.cells.first().copied();
            while let Some(current) = cell {
                if forced[current] != 0 || input.water_kind.get(current)? == 1 {
                    break;
                }
                forced[current] = 1;
                cell = usize::try_from(input.targets.get(current)?).ok();
            }
        }
        let origins = channel_length
            .map(|length| {
                channel_origins(
                    input.mesh,
                    &year.order.read_only(),
                    input.targets,
                    length,
                    coverage,
                )
            })
            .transpose()?;
        self.advance(&RoutedEnvironment {
            input,
            year,
            sizes,
            forced,
            origins,
        })
    }
}
impl RiverEnvironment for RoutedEnvironment<'_> {
    fn count(&self) -> usize {
        self.input.mesh.len()
    }
    fn ordered(&self, at: usize) -> io::Result<usize> {
        Ok(self.year.order.get(at)? as usize)
    }
    fn next(&self, cell: usize) -> io::Result<Option<usize>> {
        Ok(usize::try_from(self.input.targets.get(cell)?).ok())
    }
    fn land(&self, cell: usize) -> io::Result<bool> {
        Ok(self.input.water_kind.get(cell)? == 0)
    }
    fn resolved(&self, cell: usize) -> io::Result<bool> {
        if self.forced.get(cell).copied().unwrap_or(0) > 0 {
            return Ok(true);
        }
        if !self
            .sizes
            .gathered(self.input.catchment.get(cell)?, self.input.mesh.area(cell))
        {
            return Ok(false);
        }
        for month in &self.year.monthly {
            if month.get(cell)? >= self.sizes.discharge {
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn flow(&self, cell: usize, month: usize) -> io::Result<f64> {
        self.year.monthly[month].get(cell)
    }
    fn bed(&self, cell: usize) -> io::Result<f64> {
        (self.input.bed)(cell)
    }
    fn catchment(&self, cell: usize) -> io::Result<f64> {
        self.input.catchment.get(cell)
    }
    fn discharge(&self) -> f64 {
        self.sizes.discharge
    }
    fn epoch(&self) -> f64 {
        self.input.epoch
    }
    fn new_head(&self, cell: usize) -> io::Result<bool> {
        Ok(self
            .origins
            .as_ref()
            .is_none_or(|origins| origins[cell] > 0 || self.forced[cell] > 0))
    }
}
