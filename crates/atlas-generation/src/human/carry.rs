use super::{
    catalogue::{self, LayerId},
    identity,
    operations::{Apportion, Move},
    storage::{positive, unit, LayerBands},
    HumanLayers,
};
use crate::{
    hpc::group_by_label,
    storage::{Band, Coverage, ReadBand},
    transport::{TransportShares, TRANSPORT_WEIGHT_SCALE},
};
use std::io;
impl HumanLayers {
    pub(super) fn move_layer(&mut self, action: &Move, coverage: &mut Coverage) -> io::Result<()> {
        let carries = catalogue::facts(action.kind).carries_identity;
        let before = if carries {
            Some(self.bands.snapshot(coverage)?)
        } else {
            None
        };
        let mut leaving = coverage.allocate(0.0);
        let mut parts = coverage.allocate(0.0);
        let mut labels = vec![-1; self.mesh.len()];
        for (cell, label) in labels.iter_mut().enumerate() {
            let target = action.targets.get(cell)?;
            if target == cell as i32 || !self.ground(target) {
                continue;
            }
            let part = unit(action.share.get(cell)?);
            let holding = self.bands.layers[action.kind as usize].get(cell)?;
            if part <= 0.0 || holding <= 0.0 {
                continue;
            }
            *label = target;
            leaving.set(cell, holding * part)?;
            parts.set(cell, part)?;
            if carries {
                let mut column = self.column(cell)?;
                identity::part(&mut column, part);
                self.bands.write_column(cell, &column)?;
            }
        }
        self.move_amounts(action, &leaving, &labels)?;
        if let Some(before) = before {
            self.move_identities(&parts, &before, &labels)?;
        }
        Ok(())
    }
    fn move_amounts(
        &mut self,
        action: &Move,
        leaving: &Band<f64>,
        labels: &[i32],
    ) -> io::Result<()> {
        let band = &mut self.bands.layers[action.kind as usize];
        for cell in 0..self.mesh.len() {
            band.set(cell, band.get(cell)? - leaving.get(cell)?)?;
        }
        for (cell, &target) in labels.iter().enumerate() {
            let left = leaving.get(cell)?;
            if left <= 0.0 {
                continue;
            }
            let target = target as usize;
            let arriving = left * self.mesh.area(cell) / self.mesh.area(target);
            let added = arriving.min(self.room(action.kind, target)?);
            let band = &mut self.bands.layers[action.kind as usize];
            band.set(target, band.get(target)? + added)?;
            self.walk(action.kind, cell, left, action.years)?;
            self.walk(action.kind, target, arriving, action.years)?;
        }
        Ok(())
    }
    fn move_identities(
        &mut self,
        parts: &Band<f64>,
        before: &LayerBands,
        labels: &[i32],
    ) -> io::Result<()> {
        let groups = group_by_label(labels, self.mesh.len());
        for target in 0..self.mesh.len() {
            let sources = groups.members_of(target);
            if sources.is_empty() {
                continue;
            }
            let mut arriving = Vec::new();
            for &source in sources {
                let mut column = before.column(source)?;
                let mut parted = identity::part(&mut column, parts.get(source)?);
                for layer in &mut parted {
                    layer.people *= self.mesh.area(source) / self.mesh.area(target);
                }
                arriving.extend(parted);
            }
            let mut column = self.column(target)?;
            identity::arrive(&mut column, &arriving);
            self.bands.write_column(target, &column)?;
        }
        Ok(())
    }
    fn walk(&mut self, kind: LayerId, cell: usize, density: f64, years: f64) -> io::Result<()> {
        if catalogue::facts(kind).records_ground {
            self.records[1].set(
                cell,
                self.records[1].get(cell)? + density * self.km2(cell) * positive(years),
            )?;
        }
        Ok(())
    }
    pub(super) fn carry(
        &mut self,
        plan: &TransportShares,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let before = self.bands.snapshot(coverage)?;
        let mut most = coverage.allocate(0.0);
        self.bands.clear(self.mesh.len())?;
        for source in 0..self.mesh.len() {
            for offset in plan.offsets.get(source)?..plan.offsets.get(source + 1)? {
                let target = plan.targets.get(offset as usize)?;
                if !self.ground(target) {
                    continue;
                }
                let target = target as usize;
                let share = plan.weights.get(offset as usize)? / TRANSPORT_WEIGHT_SCALE
                    * self.mesh.area(source)
                    / self.mesh.area(target);
                self.arrive(&before, &mut most, source, target, share)?;
            }
        }
        for cell in 0..self.mesh.len() {
            self.settle_area(cell)?;
            let arrived = self.bands.remains[0].get(cell)?;
            self.bands.remains[2].set(
                cell,
                if arrived > 0.0 {
                    self.bands.remains[2].get(cell)? / arrived
                } else {
                    0.0
                },
            )?;
            self.bands.remains[0].set(cell, arrived.min(1.0))?;
        }
        Ok(())
    }
    fn arrive(
        &mut self,
        before: &LayerBands,
        most: &mut Band<f64>,
        source: usize,
        target: usize,
        share: f64,
    ) -> io::Result<()> {
        for (current, prior) in self
            .bands
            .layers
            .iter_mut()
            .chain(&mut self.bands.remains[..2])
            .zip(before.layers.iter().chain(&before.remains[..2]))
        {
            current.set(target, current.get(target)? + prior.get(source)? * share)?;
        }
        let ruins = before.remains[0].get(source)? * share;
        self.bands.remains[2].set(
            target,
            self.bands.remains[2].get(target)? + before.remains[2].get(source)? * ruins,
        )?;
        if ruins > most.get(target)? {
            most.set(target, ruins)?;
            self.bands
                .ruin_tongue
                .set(target, before.ruin_tongue.get(source)?)?;
        }
        let mut arriving = before.column(source)?;
        if arriving.is_empty() {
            return Ok(());
        }
        for layer in &mut arriving {
            layer.people *= share;
        }
        let mut column = self.column(target)?;
        identity::arrive(&mut column, &arriving);
        self.bands.write_column(target, &column)
    }
    fn settle_area(&mut self, cell: usize) -> io::Result<()> {
        let mut used = 0.0;
        for kind in LayerId::ALL {
            if catalogue::facts(kind).area {
                used += self.bands.layers[kind as usize].get(cell)?;
            }
        }
        if used > 1.0 {
            for kind in LayerId::ALL {
                if catalogue::facts(kind).area {
                    let band = &mut self.bands.layers[kind as usize];
                    band.set(cell, band.get(cell)? / used)?;
                }
            }
        }
        Ok(())
    }
    pub(super) fn apportion(&mut self, action: &Apportion) -> io::Result<()> {
        let mut count = 0;
        for cell in 0..self.mesh.len() {
            count = count.max((action.groups.get(cell)? as i64 + 1).max(0) as usize);
        }
        if count == 0 {
            return Ok(());
        }
        for &kind in &action.kinds {
            share_out(
                &self.mesh,
                &mut self.bands.layers[kind as usize],
                &action.groups,
                &action.weight,
                count,
            )?;
            if catalogue::facts(kind).carries_identity {
                for slot in &mut self.bands.identity {
                    share_out(
                        &self.mesh,
                        &mut slot.people,
                        &action.groups,
                        &action.weight,
                        count,
                    )?;
                }
            }
        }
        for cell in 0..self.mesh.len() {
            self.settle_area(cell)?;
        }
        Ok(())
    }
}
fn share_out(
    mesh: &crate::lattice::TriangularLattice,
    band: &mut Band<f64>,
    groups: &ReadBand<i32>,
    weight: &ReadBand<f64>,
    count: usize,
) -> io::Result<()> {
    let mut held = vec![0.0; count];
    let mut weighted = vec![0.0; count];
    for cell in 0..mesh.len() {
        let group = groups.get(cell)?;
        if group < 0 || mesh.area(cell) <= 0.0 {
            continue;
        }
        // Both sums use the same area unit, so their ratio is independent of its conversion.
        let amount = band.get(cell)? * mesh.area(cell);
        held[group as usize] += amount;
        weighted[group as usize] += amount * weight.get(cell)?.max(0.0);
    }
    for cell in 0..mesh.len() {
        let group = groups.get(cell)?;
        if group < 0 || mesh.area(cell) <= 0.0 || weighted[group as usize] <= 0.0 {
            continue;
        }
        band.set(
            cell,
            band.get(cell)? * weight.get(cell)?.max(0.0) * held[group as usize]
                / weighted[group as usize],
        )?;
    }
    Ok(())
}
