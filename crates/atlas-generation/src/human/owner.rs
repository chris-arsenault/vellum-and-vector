use super::{
    catalogue::{self, LayerId},
    identity,
    operations::*,
    storage::{positive, unit},
    HumanLayers,
};
use crate::storage::ReadBand;
use std::io;
impl HumanLayers {
    /// A death source consumes the current record once; later events can supply another.
    pub fn take_deaths(&mut self, cell: usize) -> io::Result<f64> {
        let value = self.records[2].get(cell)?;
        if value > 0.0 {
            self.records[2].set(cell, 0.0)?;
        }
        Ok(value)
    }
    /// Captured maintained ground arrives before any new living pass writes its history.
    pub fn capture_place_records(&mut self, records: [Option<ReadBand<f64>>; 4]) -> io::Result<()> {
        for (index, source) in [0, 1, 3, 2].into_iter().zip(records) {
            if let Some(source) = source {
                for cell in 0..self.mesh.len() {
                    self.records[index].set(cell, source.get(cell)?)?;
                }
            }
        }
        Ok(())
    }
    pub(super) fn lay(&mut self, action: &Lay) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let added = positive(action.amount.get(cell)?).min(self.room(action.kind, cell)?);
            if added > 0.0 {
                let band = &mut self.bands.layers[action.kind as usize];
                band.set(cell, band.get(cell)? + added)?;
            }
        }
        Ok(())
    }
    pub(super) fn convert(&mut self, action: &Convert) -> io::Result<()> {
        if !catalogue::facts(action.from).area || !catalogue::facts(action.to).area {
            return Err(io::Error::other(
                "Only land in use converts, and only into another use of land",
            ));
        }
        for cell in 0..self.mesh.len() {
            let source = &mut self.bands.layers[action.from as usize];
            let changed = positive(action.amount.get(cell)?).min(source.get(cell)?);
            if changed <= 0.0 {
                continue;
            }
            source.set(cell, source.get(cell)? - changed)?;
            let target = &mut self.bands.layers[action.to as usize];
            target.set(cell, target.get(cell)? + changed)?;
        }
        Ok(())
    }
    pub(super) fn overlay(&mut self, action: &Overlay) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let taking = positive(action.people.get(cell)?);
            if taking <= 0.0 {
                continue;
            }
            let mut changes = [None; 5];
            for (next, codes) in changes.iter_mut().zip(&action.traditions) {
                if let Some(codes) = codes {
                    let code = codes.get(cell)?;
                    if code > 0 {
                        *next = Some(code);
                    }
                }
            }
            let mut column = self.column(cell)?;
            let held: f64 = column.iter().map(|layer| layer.people).sum();
            identity::overlay(
                &mut column,
                &changes,
                taking,
                unit(action.hardness),
                self.people(cell)? - held,
            );
            self.bands.write_column(cell, &column)?;
        }
        Ok(())
    }
    pub(super) fn rename(&mut self, action: &Rename) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let next = action.to.get(cell)?;
            if next < 0 || next == action.from {
                continue;
            }
            let mut column = self.column(cell)?;
            if column
                .iter()
                .any(|layer| layer.traditions[action.tradition as usize] == action.from)
            {
                identity::rename(&mut column, action.tradition, action.from, next);
                self.bands.write_column(cell, &column)?;
            }
        }
        Ok(())
    }
    pub(super) fn inherit(&mut self) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let mut column = self.column(cell)?;
            if column.is_empty() {
                continue;
            }
            let held: f64 = column.iter().map(|layer| layer.people).sum();
            let people = self.people(cell)?;
            if held < people {
                identity::fit(&mut column, people);
                self.bands.write_column(cell, &column)?;
            }
        }
        Ok(())
    }
    pub(super) fn harden(&mut self, action: &Harden) -> io::Result<()> {
        let elapsed = positive(action.years);
        let set = 1.0 - (-elapsed / action.settling.max(1.0)).exp();
        for cell in 0..self.mesh.len() {
            let mut column = self.column(cell)?;
            if column.is_empty() {
                continue;
            }
            let most = 0.2 + 0.7 * self.standing(cell)?;
            for layer in &mut column {
                layer.age += elapsed;
                if layer.hardness < most {
                    layer.hardness += (most - layer.hardness) * set;
                }
            }
            self.bands.write_column(cell, &column)?;
        }
        Ok(())
    }
    pub(super) fn reexpose_identity(&mut self, people: &ReadBand<f64>) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let leaving = positive(people.get(cell)?);
            if leaving <= 0.0 {
                continue;
            }
            let mut column = self.column(cell)?;
            identity::reexpose(&mut column, leaving);
            self.bands.write_column(cell, &column)?;
        }
        Ok(())
    }
    pub(super) fn travel(&mut self, years: &ReadBand<f64>) -> io::Result<()> {
        for kind in LayerId::ALL {
            if !catalogue::facts(kind).records_ground {
                continue;
            }
            for cell in 0..self.mesh.len() {
                let worn = positive(years.get(cell)?);
                if worn > 0.0 {
                    self.records[1].set(cell, self.records[1].get(cell)? + worn)?;
                }
            }
        }
        Ok(())
    }
    pub(super) fn keep(&mut self, action: &Keep) -> io::Result<()> {
        for &cell in &action.cells {
            self.records[3].set(cell, self.records[3].get(cell)? + positive(action.years))?;
        }
        Ok(())
    }
    pub(super) fn maintain_lines(
        &mut self,
        action: &KeptLineTargets,
        coverage: &mut crate::storage::Coverage,
    ) -> io::Result<()> {
        let applied = self
            .place_kept
            .get_or_insert_with(|| coverage.allocate(0.0));
        for cell in 0..self.mesh.len() {
            let base = self.records[3].get(cell)? - applied.get(cell)?;
            let next = (base + action.add.get(cell)?)
                .max(action.at_least.get(cell)?)
                .min(action.at_most.get(cell)?);
            self.records[3].set(cell, next)?;
            applied.set(cell, next - base)?;
        }
        Ok(())
    }
    pub(super) fn dwell(&mut self, action: &Dwelling) -> io::Result<()> {
        let elapsed = positive(action.years);
        for kind in LayerId::ALL {
            if !catalogue::facts(kind).records_ground {
                continue;
            }
            for cell in 0..self.mesh.len() {
                let holding = self.bands.layers[kind as usize].get(cell)?;
                if holding > 0.0 {
                    self.records[0].set(
                        cell,
                        self.records[0].get(cell)? + holding * self.km2(cell) * elapsed,
                    )?;
                }
            }
        }
        self.forget(action.years, action.fading.as_ref())
    }
    pub(super) fn forget(&mut self, years: f64, fading: Option<&ReadBand<f64>>) -> io::Result<()> {
        let usual = positive(years) / catalogue::WAY_MEMORY_YEARS;
        for index in [1, 3] {
            for cell in 0..self.mesh.len() {
                let rate = positive(fading.map_or(Ok(1.0), |band| band.get(cell))?);
                self.records[index]
                    .set(cell, self.records[index].get(cell)? * (-usual * rate).exp())?;
            }
        }
        Ok(())
    }
}
