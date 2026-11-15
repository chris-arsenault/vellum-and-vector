//! Course transport, query reads and projections of the retained network.
use super::{
    balance::{flow_through_year, MONTHS},
    reaches::{Reach, ReachIndex, ReachStore},
};
use crate::{
    lattice::TriangularLattice,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, Coverage, ReadBand},
    transport::TransportShares,
};
use std::{io, rc::Rc};

pub const RIVER_DISCHARGE: f64 = 5.46875e-18;
pub const RIVER_CATCHMENT: f64 = 0.00125;
pub struct RiverSizes {
    pub discharge: f64,
    pub catchment: f64,
}
impl RiverSizes {
    pub fn at(scale: &MapScale) -> Result<Self, &'static str> {
        Ok(Self {
            discharge: scale
                .resolve(RelativeMeasure::new(
                    RIVER_DISCHARGE,
                    3,
                    1.0,
                    LengthUnit::Metre,
                )?)?
                .value(),
            catchment: scale
                .resolve(RelativeMeasure::new(
                    RIVER_CATCHMENT,
                    2,
                    1.0,
                    LengthUnit::Metre,
                )?)?
                .value(),
        })
    }
    // owner-direction(2026-11-12): a cell's own yield, however large, never makes it a river
    pub fn gathered(&self, catchment: f64, own_area: f64) -> bool {
        catchment > own_area && catchment >= self.catchment
    }
}

/// A single derived index is shared by all point reads in this unchanged-state query.
pub struct RiverReader<'a> {
    store: &'a ReachStore,
    index: Rc<ReachIndex>,
}
impl ReachStore {
    pub fn reader(&self) -> RiverReader<'_> {
        RiverReader {
            store: self,
            index: self.cell_index(),
        }
    }
    pub fn associate_publication(&mut self, river: &str, record: Option<&str>, name: &str) {
        for reach in self
            .records_mut()
            .iter_mut()
            .flatten()
            .filter(|reach| reach.river.as_deref() == Some(river))
        {
            if let Some(record) = record {
                reach.record = Some(record.into());
            }
            reach.name = Some(name.into());
        }
    }
    pub fn mark_drawn(&mut self) {
        for reach in self
            .records_mut()
            .iter_mut()
            .flatten()
            .filter(|reach| !reach.dry)
        {
            reach.drawn = reach.river.is_some();
        }
    }
    pub fn retain_course(
        &mut self,
        cells: &[usize],
        identity: &str,
        name: Option<&str>,
        bed: impl Fn(usize) -> io::Result<f64>,
    ) -> io::Result<Option<usize>> {
        let mut prefix = Vec::new();
        let mut receiving = None;
        let index = self.cell_index();
        for &cell in cells {
            receiving = index.get(self, cell).map(|reach| reach.id);
            if let Some(id) = receiving {
                if !prefix.is_empty() {
                    self.split_at(id, cell);
                }
                break;
            }
            prefix.push(cell);
        }
        let id = if prefix.is_empty() {
            receiving
        } else {
            let beds = prefix
                .iter()
                .map(|&cell| bed(cell))
                .collect::<io::Result<Vec<_>>>()?;
            let id = self.add(prefix);
            let reach = self.get_mut(id).unwrap();
            reach.downstream = receiving;
            reach.bed = beds;
            reach.dry = true;
            Some(id)
        };
        if let Some(id) = id {
            let reach = self.get_mut(id).unwrap();
            let river = reach.river.get_or_insert_with(|| identity.into());
            reach
                .record
                .get_or_insert_with(|| format!("river:{river}:0"));
            if reach.name.is_none() {
                reach.name = name.map(String::from);
            }
            reach.drawn = true;
        }
        Ok(id)
    }
    pub fn carry_ground(&mut self, shares: &TransportShares, count: usize) -> io::Result<()> {
        let mut destination = vec![None; count];
        for (source, destination) in destination.iter_mut().enumerate() {
            let mut largest = 0.0;
            for at in shares.offsets.get(source)?..shares.offsets.get(source + 1)? {
                let target = usize::try_from(shares.targets.get(at as usize)?).ok();
                let weight = shares.weights.get(at as usize)?;
                if target.is_some() && weight > largest {
                    *destination = target;
                    largest = weight;
                }
            }
        }
        for reach in self.records_mut().iter_mut().flatten() {
            carry_reach(reach, &destination);
        }
        self.entries.retain_mut(|entry| {
            if let Some(cell) = destination[entry.cell] {
                entry.cell = cell;
                true
            } else {
                false
            }
        });
        Ok(())
    }
}
fn moved_positions(cells: &[usize], destination: &[Option<usize>]) -> Vec<(usize, usize)> {
    cells
        .iter()
        .enumerate()
        .filter_map(|(at, &cell)| {
            let target = destination[cell]?;
            (at == 0 || destination[cells[at - 1]] != Some(target)).then_some((target, at))
        })
        .collect()
}
fn carry_reach(reach: &mut Reach, destination: &[Option<usize>]) {
    let positions = moved_positions(&reach.cells, destination);
    reach.monthly = positions
        .iter()
        .flat_map(|(_, at)| {
            reach.monthly[(at * MONTHS).min(reach.monthly.len())
                ..((at + 1) * MONTHS).min(reach.monthly.len())]
                .iter()
                .copied()
        })
        .collect();
    for profile in [
        &mut reach.bed,
        &mut reach.width,
        &mut reach.depth,
        &mut reach.leakage,
        &mut reach.catchment,
    ] {
        *profile = positions
            .iter()
            .map(|(_, at)| profile.get(*at).copied().unwrap_or(f64::NAN))
            .collect();
    }
    reach.cells = positions.iter().map(|(cell, _)| *cell).collect();
    reach.former.retain_mut(|course| {
        course.cells = moved_positions(&course.cells, destination)
            .iter()
            .map(|(cell, _)| *cell)
            .collect();
        !course.cells.is_empty()
    });
    if reach.cells.is_empty() {
        reach.dry = true;
    }
}
pub struct RiverTerrain<'a> {
    pub mesh: &'a TriangularLattice,
    pub water_kind: &'a ReadBand<u8>,
    pub targets: &'a ReadBand<i32>,
}
fn adjacent(mesh: &TriangularLattice, cell: usize, next: usize) -> bool {
    (0..3).any(|edge| mesh.neighbor(cell, edge) == Some(next))
}
impl<'a> RiverReader<'a> {
    pub fn leakage_at(&self, cell: usize) -> Option<f64> {
        let reach = self.at(cell)?;
        reach.leakage.get(self.index.position(cell)?).copied()
    }
    pub fn at(&self, cell: usize) -> Option<&'a Reach> {
        self.index.get(self.store, cell)
    }
    pub fn successor(
        &self,
        cell: usize,
        course: Option<&Reach>,
        terrain: &RiverTerrain<'_>,
    ) -> io::Result<Option<usize>> {
        let Some(reach) = course.or_else(|| self.at(cell)) else {
            return Ok(None);
        };
        let Some(at) = reach.cells.iter().position(|member| *member == cell) else {
            return Ok(None);
        };
        if let Some(&next) = reach.cells.get(at + 1) {
            return Ok(Some(next));
        }
        let next = if let Some(id) = reach.downstream {
            self.store.get(id).and_then(|r| r.cells.first()).copied()
        } else if reach.dry {
            None
        } else {
            let target = usize::try_from(terrain.targets.get(cell)?).ok();
            match target {
                Some(target) if terrain.water_kind.get(target)? != 0 => Some(target),
                _ => None,
            }
        };
        Ok(next.filter(|&next| adjacent(terrain.mesh, cell, next)))
    }
    pub fn order_at(&self, cell: usize, water_kind: u8) -> u16 {
        let Some(reach) = self.at(cell) else {
            return 0;
        };
        if water_kind == 0
            && reach.drawn
            && !reach.dry
            && reach.months_at(self.index.position(cell).unwrap()) > 0
        {
            reach.order
        } else {
            0
        }
    }
    pub fn water_at(&self, cell: usize, flood: bool, unresolved: f64) -> f64 {
        let Some(reach) = self.at(cell) else {
            return unresolved;
        };
        let at = self.index.position(cell).unwrap();
        let start = (at * MONTHS).min(reach.monthly.len());
        let end = ((at + 1) * MONTHS).min(reach.monthly.len());
        let flow = flow_through_year(&reach.monthly[start..end], 0.0);
        if flood {
            flow.flood
        } else {
            flow.mean
        }
    }
    pub fn sample(&self, cell: usize, sample: RiverSample, unresolved: f64) -> f64 {
        let Some(reach) = self.at(cell) else {
            return unresolved;
        };
        let at = self.index.position(cell).unwrap();
        match sample {
            RiverSample::Bed => reach.bed.get(at).copied().unwrap_or(f64::NAN),
            RiverSample::Width => reach.width.get(at).copied().unwrap_or(f64::NAN),
            RiverSample::Depth => reach.depth.get(at).copied().unwrap_or(f64::NAN),
            RiverSample::Catchment => reach.catchment.get(at).copied().unwrap_or(f64::NAN),
            RiverSample::Months => reach.months_at(at) as f64,
        }
    }
}
pub enum RiverSample {
    Bed,
    Width,
    Depth,
    Catchment,
    Months,
}

/// An existing connected, descending bed retains its route even if another neighbor is preferred.
pub fn retain_routes(
    store: &ReachStore,
    terrain: &RiverTerrain<'_>,
    drainage: &ReadBand<f64>,
    ranks: &ReadBand<i32>,
    targets: &mut Band<i32>,
) -> io::Result<()> {
    for reach in store.reaches() {
        for edge in reach.cells.windows(2) {
            let (cell, next) = (edge[0], edge[1]);
            if terrain.water_kind.get(cell)? != 0 || !adjacent(terrain.mesh, cell, next) {
                continue;
            }
            let height = drainage.get(cell)?;
            let lower = drainage.get(next)?;
            if lower < height || (lower == height && ranks.get(next)? < ranks.get(cell)?) {
                targets.set(cell, next as i32)?;
            }
        }
    }
    Ok(())
}
pub struct RiverProjection {
    orders: Band<u32>,
    months: Band<u8>,
    small_channels: Band<f64>,
    pub(super) spines: Band<u8>,
}
impl RiverProjection {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.band("river-orders", &mut self.orders)?;
        archive.band("river-months", &mut self.months)?;
        archive.band("river-small-channels", &mut self.small_channels)?;
        archive.band("river-spines", &mut self.spines)
    }
    pub(super) fn inherit(
        &mut self,
        cell: usize,
        order: Option<u32>,
        length: Option<f64>,
    ) -> io::Result<()> {
        if let Some(order) = order {
            self.orders.set(cell, order)?;
        }
        if let Some(length) = length {
            self.small_channels.set(cell, length)?;
        }
        Ok(())
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            orders: coverage.allocate(0),
            months: coverage.allocate(0),
            small_channels: coverage.allocate(0.0),
            spines: coverage.allocate(0),
        }
    }
    pub fn orders(&self) -> ReadBand<u32> {
        self.orders.read_only()
    }
    pub fn months(&self) -> ReadBand<u8> {
        self.months.read_only()
    }
    pub fn small_channels(&self) -> ReadBand<f64> {
        self.small_channels.read_only()
    }
    pub fn spines(&self) -> ReadBand<u8> {
        self.spines.read_only()
    }
    pub fn project_spines(&mut self, terrain: &RiverTerrain<'_>) -> io::Result<()> {
        for cell in 0..self.spines.len() {
            self.spines.set(cell, 0)?;
        }
        for cell in 0..self.spines.len() {
            let Ok(target) = usize::try_from(terrain.targets.get(cell)?) else {
                continue;
            };
            let carries = self.orders.get(cell)? > 0
                || (terrain.water_kind.get(cell)? == 2
                    && terrain.water_kind.get(target)? != 2
                    && self.orders.get(target)? > 0);
            if !carries {
                continue;
            }
            let source_edge =
                (0..3).find(|&edge| terrain.mesh.neighbor(cell, edge) == Some(target));
            let target_edge =
                (0..3).find(|&edge| terrain.mesh.neighbor(target, edge) == Some(cell));
            let (Some(source_edge), Some(target_edge)) = (source_edge, target_edge) else {
                return Err(io::Error::other(
                    "River spine contains a non-adjacent segment",
                ));
            };
            self.spines
                .set(cell, self.spines.get(cell)? | (1 << source_edge))?;
            self.spines
                .set(target, self.spines.get(target)? | (1 << target_edge))?;
        }
        Ok(())
    }
    pub fn project_orders(&mut self, store: &ReachStore, kind: &ReadBand<u8>) -> io::Result<()> {
        for cell in 0..self.orders.len() {
            self.orders.set(cell, 0)?;
            self.months.set(cell, 0)?;
        }
        for reach in store.reaches().filter(|r| !r.dry && r.drawn) {
            for (at, &cell) in reach.cells.iter().enumerate() {
                if kind.get(cell)? != 0 {
                    continue;
                }
                let months = reach.months_at(at);
                if months == 0 {
                    continue;
                }
                self.orders.set(cell, u32::from(reach.order))?;
                self.months.set(cell, months as u8)?;
            }
        }
        Ok(())
    }
    pub fn project(
        &mut self,
        store: &ReachStore,
        terrain: &RiverTerrain<'_>,
        flood: &ReadBand<f64>,
    ) -> io::Result<()> {
        self.project_orders(store, terrain.water_kind)?;
        for cell in 0..self.orders.len() {
            let next = usize::try_from(terrain.targets.get(cell)?).ok();
            let length = match next {
                Some(next) if terrain.water_kind.get(cell)? == 0 && flood.get(cell)? > 0.0 => {
                    terrain.mesh.physical_distance(cell, next)
                }
                _ => 0.0,
            };
            self.small_channels.set(cell, length)?;
        }
        for reach in store.reaches().filter(|r| !r.dry && r.drawn) {
            for &cell in &reach.cells {
                self.small_channels.set(cell, 0.0)?;
            }
        }
        Ok(())
    }
}
