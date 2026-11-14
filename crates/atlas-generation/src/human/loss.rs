use super::{
    catalogue::{facts, LayerId},
    operations::Wear,
    storage::{positive, unit},
    HumanLayers,
};
use crate::storage::ReadBand;
use std::io;
impl HumanLayers {
    fn leave(
        &mut self,
        cell: usize,
        band: usize,
        amount: f64,
        covered: f64,
        tongue: i32,
    ) -> io::Result<()> {
        if band != 0 {
            if amount > 0.0 {
                self.bands.remains[band].set(cell, self.bands.remains[band].get(cell)? + amount)?;
            }
            return Ok(());
        }
        let before = self.bands.remains[0].get(cell)?;
        let added = amount.min(1.0 - before);
        if added <= 0.0 {
            return Ok(());
        }
        self.bands.remains[2].set(
            cell,
            (self.bands.remains[2].get(cell)? * before + covered * added) / (before + added),
        )?;
        if tongue != 0 && (added >= before || self.bands.ruin_tongue.get(cell)? == 0) {
            self.bands.ruin_tongue.set(cell, tongue)?;
        }
        self.bands.remains[0].set(cell, before + added)
    }
    fn lose(
        &mut self,
        cell: usize,
        share: [f64; 5],
        left: [f64; 5],
        covered: f64,
    ) -> io::Result<()> {
        let living = self.people(cell)?;
        let tongue = self
            .column(cell)?
            .first()
            .map_or(0, |layer| layer.traditions[0]);
        for kind in LayerId::ALL {
            let index = kind as usize;
            let taken = self.bands.layers[index].get(cell)? * unit(share[index]);
            if taken <= 0.0 {
                continue;
            }
            self.bands.layers[index].set(cell, self.bands.layers[index].get(cell)? - taken)?;
            if covered == 0.0 && facts(kind).records_ground {
                self.records[2].set(cell, self.records[2].get(cell)? + taken * self.km2(cell))?;
            }
            if let Some(remains) = facts(kind).remains {
                self.leave(cell, remains, taken * left[index], covered, tongue)?;
            }
        }
        if living > 0.0 {
            self.thin_column(cell, self.people(cell)? / living)?;
        }
        Ok(())
    }
    pub(super) fn wear(&mut self, action: &Wear) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let force = positive(action.intensity.get(cell)?);
            if force <= 0.0 {
                continue;
            }
            let held = self.standing(cell)?;
            let shares = std::array::from_fn(|index| {
                (1.0 - (-action.mix.yields[index] * force).exp())
                    / (1.0 + facts(LayerId::ALL[index]).standing_holds * held)
            });
            self.lose(cell, shares, action.mix.left, 0.0)?;
        }
        Ok(())
    }
    pub(super) fn bury(&mut self, covered: &ReadBand<f64>) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let share = unit(covered.get(cell)?);
            if share <= 0.0 {
                continue;
            }
            let cover = self.bands.remains[2].get(cell)?;
            self.bands.remains[2].set(cell, cover + (1.0 - cover) * share)?;
            self.lose(cell, [share; 5], [1.0; 5], 1.0)?;
        }
        Ok(())
    }
    pub(super) fn reexpose(&mut self, share: &ReadBand<f64>) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let opened = unit(share.get(cell)?);
            if opened > 0.0 {
                self.bands.remains[2]
                    .set(cell, self.bands.remains[2].get(cell)? * (1.0 - opened))?;
            }
        }
        Ok(())
    }
}
