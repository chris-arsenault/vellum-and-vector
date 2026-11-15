//! Typical-year melt follows the snow carried by ice, independently of epoch thinning.
use super::ledger::{Move, WaterLedger};
use crate::{
    flow_graph::target_order,
    lattice::TriangularLattice,
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Meltwater {
    external: Band<f64>,
    glacial: Band<f64>,
}
pub struct MeltwaterView {
    pub external: ReadBand<f64>,
    pub glacial: ReadBand<f64>,
}
pub struct MeltInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub water_kind: &'a ReadBand<u8>,
    pub ice_thickness: &'a ReadBand<f64>,
    pub snow_kept: &'a ReadBand<f64>,
    pub temperature: &'a ReadBand<f64>,
    pub targets: &'a ReadBand<i32>,
    pub temperature_floor: f64,
    pub ice_threshold: f64,
}
#[derive(Default)]
struct IceWater {
    fed: f64,
    outside: f64,
    calved: f64,
    sublimed: f64,
}
impl MeltInputs<'_> {
    fn iced(&self, cell: usize) -> io::Result<bool> {
        Ok(self.water_kind.get(cell)? == 0 && self.ice_thickness.get(cell)? > 0.0)
    }
    fn thaw_share(&self, cell: usize) -> io::Result<f64> {
        Ok(((self.temperature.get(cell)? - self.temperature_floor)
            / (self.ice_threshold - self.temperature_floor).max(1.0))
        .clamp(0.0, 1.0))
    }
}
impl Meltwater {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.band("melt-external", &mut self.external)?;
        archive.band("melt-glacial", &mut self.glacial)
    }
    pub fn clear_glacial(&mut self) -> io::Result<()> {
        for cell in 0..self.glacial.len() {
            self.glacial.set(cell, 0.0)?;
        }
        Ok(())
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            external: coverage.allocate(0.0),
            glacial: coverage.allocate(0.0),
        }
    }
    pub fn read_only(&self) -> MeltwaterView {
        MeltwaterView {
            external: self.external.read_only(),
            glacial: self.glacial.read_only(),
        }
    }
    pub fn receive(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        if depth > 0.0 {
            self.external.set(cell, self.external.get(cell)? + depth)?;
        }
        Ok(())
    }
    pub fn begin_epoch(&mut self) -> io::Result<()> {
        for cell in 0..self.external.len() {
            self.external.set(cell, 0.0)?;
        }
        Ok(())
    }
    pub fn release_year(
        &mut self,
        input: MeltInputs<'_>,
        ledger: &mut WaterLedger,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let order = target_order(coverage, input.targets)?;
        let mut carried = coverage.scratch(input.mesh.len(), 0.0);
        let mut totals = IceWater::default();
        for at in 0..order.len() {
            let cell = order.get(at)? as usize;
            let out = self.release(&input, cell, &mut carried, &mut totals)?;
            if input.water_kind.get(cell)? != 0 {
                self.glacial.set(cell, 0.0)?;
            } else {
                self.glacial.set(
                    cell,
                    MapScale::in_units(out / input.mesh.area(cell), LengthUnit::Millimetre),
                )?;
                totals.fed += out;
            }
        }
        ledger.state(Move::MeltOfKeptSnow, totals.fed - totals.outside);
        ledger.state(Move::MeltFromOutside, totals.outside);
        ledger.state(Move::Calving, totals.calved);
        ledger.state(Move::Sublimation, totals.sublimed);
        Ok(())
    }
    fn release(
        &self,
        input: &MeltInputs<'_>,
        cell: usize,
        carried: &mut Band<f64>,
        totals: &mut IceWater,
    ) -> io::Result<f64> {
        let snow = MapScale::metres(input.snow_kept.get(cell)?, LengthUnit::Millimetre)
            * input.mesh.area(cell);
        let held = carried.get(cell)? + snow;
        if input.water_kind.get(cell)? != 0 {
            totals.calved += held;
            return Ok(0.0);
        }
        if self.external.get(cell)? > 0.0 {
            totals.outside += held;
            return Ok(held);
        }
        if !input.iced(cell)? {
            totals.sublimed += snow;
            return carried.get(cell);
        }
        let target = usize::try_from(input.targets.get(cell)?).ok();
        let onward = match target {
            Some(target) => input.iced(target)? || input.water_kind.get(target)? != 0,
            None => false,
        };
        let out = if onward {
            held * input.thaw_share(cell)?
        } else {
            held
        };
        if let Some(target) = target.filter(|_| onward) {
            carried.set(target, carried.get(target)? + held - out)?;
        }
        Ok(out)
    }
}
