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
    pub(super) fn place_households(
        &mut self,
        transfers: &[super::operations::HouseholdTransfers],
    ) -> io::Result<()> {
        let population = LayerId::Population as usize;
        for transfer in transfers {
            let mut arrivals = Vec::new();
            let mut people = 0.;
            for &(cell, fraction) in &transfer.sources {
                let area = self.km2(cell);
                let before = self.bands.layers[population].get(cell)?;
                let heads = before * fraction;
                let mut column = self.column(cell)?;
                let mut departing = identity::part(&mut column, fraction);
                for group in &mut departing {
                    group.people *= area;
                }
                identity::accumulate(&mut arrivals, &departing);
                self.bands.write_column(cell, &column)?;
                self.bands.layers[population].set(cell, before - heads)?;
                people += heads * area;
            }
            for &(cell, share) in &transfer.receivers {
                let factor = share / self.km2(cell);
                let mut column = self.column(cell)?;
                let mut incoming = arrivals.clone();
                for group in &mut incoming {
                    group.people *= factor;
                }
                identity::arrive(&mut column, &incoming);
                self.bands.write_column(cell, &column)?;
                let prior = self.bands.layers[population].get(cell)?;
                self.bands.layers[population].set(cell, prior + people * factor)?;
            }
        }
        Ok(())
    }
    /// Transfer developed land to the places using it. Open ground receives it first.
    /// Where households take cultivated land, its former use occupies the vacated area.
    pub(super) fn place_land(
        &mut self,
        action: &super::operations::LandPlacement,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        if !catalogue::facts(action.kind).area {
            return Err(io::Error::other("Land placement requires an area layer"));
        }
        use super::operations::LandMovement;
        let stock = self.bands.layers[action.kind as usize].snapshot()?;
        let local;
        let flows = match &action.movement {
            LandMovement::Local(movement) => {
                local = self.local_land_transfers(movement, &stock)?;
                &local
            }
            LandMovement::Surveyed(flows) => flows,
        };
        if flows.is_empty() {
            return Ok(());
        }
        let mut arrivals = coverage.scratch(self.mesh.len(), 0.0);
        let mut departures = coverage.scratch(self.mesh.len(), 0.0);
        for &(from, to, area) in flows {
            departures.set(from, departures.get(from)? + area / self.km2(from))?;
            arrivals.set(to, arrivals.get(to)? + area / self.km2(to))?;
        }
        let displaced = self.displaced_share(coverage, &arrivals)?;
        let farm = self.bands.layers[LayerId::Farmland as usize].snapshot()?;
        let herd = self.bands.layers[LayerId::Pasture as usize].snapshot()?;
        for &(from, to, area) in flows {
            let crop = if action.kind == LayerId::Farmland {
                0.0
            } else {
                farm.get(to)?
            };
            let grazing = if action.kind == LayerId::Pasture {
                0.0
            } else {
                herd.get(to)?
            };
            let worked = crop + grazing;
            if worked <= 0.0 {
                continue;
            }
            let exchanged = area / self.km2(from) * displaced.get(to)?;
            for (kind, share) in [
                (LayerId::Farmland, crop / worked),
                (LayerId::Pasture, grazing / worked),
            ] {
                let land = &mut self.bands.layers[kind as usize];
                land.set(
                    to,
                    land.get(to)? - exchanged * share * self.mesh.area(from) / self.mesh.area(to),
                )?;
                land.set(from, land.get(from)? + exchanged * share)?;
            }
        }
        for cell in 0..self.mesh.len() {
            self.bands.layers[action.kind as usize].set(
                cell,
                stock.get(cell)? - departures.get(cell)? + arrivals.get(cell)?,
            )?;
        }
        Ok(())
    }

    fn local_land_transfers(
        &self,
        movement: &super::operations::Placement,
        stock: &Band<f64>,
    ) -> io::Result<Vec<(usize, usize, f64)>> {
        let mut flows = Vec::new();
        for from in 0..self.mesh.len() {
            let to = movement.targets.get(from)?;
            if self.ground(to) {
                let area = stock.get(from)? * unit(movement.share.get(from)?) * self.km2(from);
                if area > 0. {
                    flows.push((from, to as usize, area));
                }
            }
        }
        Ok(flows)
    }

    fn displaced_share(
        &mut self,
        coverage: &mut Coverage,
        arrivals: &Band<f64>,
    ) -> Result<Band<f64>, io::Error> {
        let mut displaced = coverage.scratch(self.mesh.len(), 0.0);
        for cell in 0..self.mesh.len() {
            let incoming = arrivals.get(cell)?;
            if incoming > 0.0 {
                displaced.set(
                    cell,
                    ((incoming - self.free_area(cell)?) / incoming).clamp(0.0, 1.0),
                )?;
            }
        }
        Ok(displaced)
    }

    /// Resolve finer sites of already ruined fabric, including the surviving stock,
    /// burial depth and language associated with its developed area.
    pub(super) fn place_ruins(
        &mut self,
        action: &super::operations::Placement,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let [area, capital, depth] = &self.bands.remains;
        let area = area.snapshot()?;
        let capital = capital.snapshot()?;
        let depth = depth.snapshot()?;
        let tongue = self.bands.ruin_tongue.snapshot()?;
        let mut largest = coverage.scratch(self.mesh.len(), 0.0);
        for cell in 0..self.mesh.len() {
            let left = if self.ground(action.targets.get(cell)?) {
                unit(action.share.get(cell)?)
            } else {
                0.0
            };
            let retained = area.get(cell)? * (1.0 - left);
            largest.set(cell, retained)?;
            self.bands.remains[0].set(cell, retained)?;
            self.bands.remains[1].set(cell, capital.get(cell)? * (1.0 - left))?;
        }
        for cell in 0..self.mesh.len() {
            let target = action.targets.get(cell)?;
            if !self.ground(target) {
                continue;
            }
            let to = target as usize;
            let share = unit(action.share.get(cell)?) * self.mesh.area(cell) / self.mesh.area(to);
            let arrived = area.get(cell)? * share;
            if arrived <= 0.0 {
                continue;
            }
            let before = self.bands.remains[0].get(to)?;
            let combined = before + arrived;
            let cover =
                (self.bands.remains[2].get(to)? * before + depth.get(cell)? * arrived) / combined;
            self.bands.remains[2].set(to, cover)?;
            self.bands.remains[0].set(to, combined)?;
            let works = self.bands.remains[1].get(to)? + capital.get(cell)? * share;
            self.bands.remains[1].set(to, works)?;
            if arrived > largest.get(to)? {
                largest.set(to, arrived)?;
                self.bands.ruin_tongue.set(to, tongue.get(cell)?)?;
            }
        }
        Ok(())
    }
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
