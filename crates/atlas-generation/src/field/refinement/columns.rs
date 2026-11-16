use super::super::{schema::NumericBand, Field};
use crate::{
    hpc::{group_by_label, BitSet},
    reconstruction::Grid,
    rock::{
        catalogue,
        ground::contacts::{Plan, Reference},
        ModeId, ModeMix,
    },
    settlement::removal::Facet,
    storage::ReadBand,
};
use std::io;

pub struct ParentContacts<'a> {
    pub grid: &'a Grid,
    pub count: usize,
    pub bedrock: &'a NumericBand,
    pub share: &'a NumericBand,
    pub depth: &'a NumericBand,
}
impl Field {
    pub fn prepare_inherited_columns(
        &mut self,
        parent: ParentContacts<'_>,
    ) -> io::Result<Vec<Plan>> {
        let groups = self.inherited_donors(parent.grid, parent.count, false)?;
        let mut ground = self.ground.borrow_mut();
        let mut plans = Vec::new();
        for donor in 0..groups.count() {
            let cells = groups.members_of(donor);
            if cells.is_empty() {
                continue;
            }
            let depth = parent.depth.get(donor)?;
            let land = parent.bedrock.get(donor)? + parent.share.get(donor)? * depth;
            let plan = Plan {
                reference: Reference {
                    position: parent.grid.position(donor)?,
                    land,
                    cut: land - depth,
                },
                beds: ground.capture_contact_beds(cells[0])?,
                cells: cells.to_vec(),
            };
            ground.realize_contacts(&plan)?;
            plans.push(plan);
        }
        Ok(plans)
    }
    fn inherited_donors(
        &self,
        grid: &Grid,
        count: usize,
        valleys_only: bool,
    ) -> io::Result<crate::hpc::LabelGroups> {
        let ground = self.ground.borrow();
        let water = self.water();
        let mut donors = vec![-1; self.mesh.len()];
        let origin = self.mesh.origin();
        for (cell, donor) in donors.iter_mut().enumerate() {
            if water.column.kind.get(cell)? == 1
                || (valleys_only && ground.share(cell, Facet::Cut)? <= 0.0)
            {
                continue;
            }
            let [x, y] = self.mesh.position(cell);
            *donor = grid.sample_index([x + origin[0], y + origin[1]])? as i32;
        }
        Ok(group_by_label(&donors, count))
    }
    pub fn place_inherited_valleys(
        &mut self,
        grid: &Grid,
        area: &[f64],
        receiver: &[i32],
        retained: &BitSet,
        root_hold: ReadBand<f64>,
    ) -> io::Result<()> {
        // owner-direction(2026-11-12): a region starts at the parent's level and gets more defined; the parent's elevation is not thrown away.
        let groups = self.inherited_donors(grid, grid.measures.len(), true)?;
        let mix = catalogue::compile(
            ModeMix::default()
                .with(ModeId::Abrasion, 0.6)
                .with(ModeId::Plucking, 0.4),
        );
        let mut scratch = super::valleys::Scratch::new(self.mesh.len());
        let mut inside = BitSet::new(self.mesh.len());
        let mut seen = BitSet::new(self.mesh.len());
        let mut ground = self.ground.borrow_mut();
        ground.root_hold(Some(root_hold));
        for donor in 0..groups.count() {
            let cells = groups.members_of(donor);
            if cells.is_empty() {
                continue;
            }
            let mut seeds: Vec<usize> = cells
                .iter()
                .copied()
                .filter(|&cell| retained.has(cell))
                .collect();
            if seeds.is_empty() {
                seeds = super::valleys::stream_cells(cells, area, receiver, &mut inside, &mut seen);
            }
            let whole: f64 = cells.iter().map(|&cell| self.mesh.area(cell)).sum();
            let order = super::valleys::order(
                &self.mesh,
                cells,
                &seeds,
                |from, toward| {
                    let response = ground.face_gives_from(from, &mix)?.at(toward)?;
                    Ok(if response > 0.0 {
                        1.0 / response
                    } else {
                        f64::INFINITY
                    })
                },
                &mut scratch,
            )?;
            let shares = super::valleys::shares(
                &order,
                seeds.len(),
                ground.share(cells[0], Facet::Cut)? * whole,
                |cell| self.mesh.area(cell),
            );
            for (&cell, share) in order.iter().zip(shares) {
                ground.resolve_cut(cell, share)?;
            }
        }
        Ok(())
    }
    pub fn realize_inherited_columns(&mut self, plans: &[Plan]) -> io::Result<()> {
        let mut ground = self.ground.borrow_mut();
        for plan in plans {
            ground.realize_contacts(plan)?;
        }
        Ok(())
    }
}
