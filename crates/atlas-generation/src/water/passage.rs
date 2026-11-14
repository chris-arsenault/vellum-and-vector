//! Resolve bed intake and downstream withdrawal once, then apply them to each routed quantity.
use super::{
    losses::{bed_leak, bed_loss, passing_water},
    network::RiverReader,
    reaches::ReachStore,
    year_routing::Passage,
};
use crate::{lattice::TriangularLattice, rock::columns::Column, storage::ReadBand};
use std::io;
pub struct PassageInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub water_kind: &'a ReadBand<u8>,
    pub cut_share: &'a ReadBand<f64>,
    pub permeability: &'a dyn Fn(usize, Option<Column>) -> io::Result<f64>,
    pub filled: &'a dyn Fn(usize) -> io::Result<f64>,
    pub open_bed_seepage: f64,
    pub withdrawal: ReadBand<f64>,
    pub transmission: ReadBand<f64>,
}
pub struct ChannelPassage<'a> {
    reader: RiverReader<'a>,
    leak: Vec<f64>,
    length: Vec<f64>,
    withdrawal: ReadBand<f64>,
    transmission: ReadBand<f64>,
}
impl ReachStore {
    pub fn prepare_passage(&mut self, input: PassageInputs<'_>) -> io::Result<ChannelPassage<'_>> {
        let mut leak = vec![0.0; input.mesh.len()];
        let mut length = vec![0.0; input.mesh.len()];
        let permeability = |cell, facet| {
            Ok(bed_leak(
                input.open_bed_seepage,
                (input.permeability)(cell, facet)?,
                (input.filled)(cell)?,
            ))
        };
        for cell in 0..input.mesh.len() {
            if input.water_kind.get(cell)? != 0 {
                continue;
            }
            leak[cell] = permeability(cell, None)?;
            length[cell] = input.mesh.area(cell).sqrt();
        }
        for reach in self.records_mut().iter_mut().flatten() {
            reach.leakage = reach
                .cells
                .iter()
                .map(|&cell| {
                    permeability(
                        cell,
                        Some(if input.cut_share.get(cell)? > 0.0 {
                            Column::Cut
                        } else {
                            Column::Land
                        }),
                    )
                })
                .collect::<io::Result<_>>()?;
        }
        Ok(ChannelPassage {
            reader: self.reader(),
            leak,
            length,
            withdrawal: input.withdrawal,
            transmission: input.transmission,
        })
    }
}
impl ChannelPassage<'_> {
    pub fn parts(&self, cell: usize, received: f64) -> io::Result<Passage> {
        let response = self.reader.leakage_at(cell).unwrap_or(self.leak[cell]);
        let bed = bed_loss(received, response, self.length[cell]);
        let passed = passing_water(
            received - bed,
            self.withdrawal.get(cell)?,
            self.transmission.get(cell)?,
        );
        Ok(Passage {
            passed,
            bed,
            drawn: received - bed - passed,
        })
    }
    pub fn reference(&self, cell: usize, received: f64, reference_runoff: f64) -> io::Result<f64> {
        let unit = super::ledger::depth_rate_to_discharge(reference_runoff, 1.0);
        Ok(if unit > 0.0 {
            self.parts(cell, received * unit)?.passed / unit
        } else {
            0.0
        })
    }
}
