//! Sediment follows retained running courses; unresolved water uses the current cell route.
use super::{network::RiverTerrain, passage::PassageInputs, Water};
use crate::{
    flow_graph,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct SedimentRouting {
    targets: Band<i32>,
    water: Band<f64>,
}
impl crate::execution::QueryValue for SedimentRouting {}
impl SedimentRouting {
    pub fn targets(&self) -> ReadBand<i32> {
        self.targets.read_only()
    }
    pub fn water(&self) -> ReadBand<f64> {
        self.water.read_only()
    }
}
impl Water {
    pub fn sediment_routing(
        &mut self,
        passage: PassageInputs<'_>,
        discharge: &ReadBand<f64>,
        reference: f64,
        coverage: &mut Coverage,
    ) -> io::Result<SedimentRouting> {
        let kind = self.column.borrow().read_only().kind;
        let flow_targets = self.routing.read_only().targets;
        let passage = self.rivers.prepare_passage(PassageInputs {
            mesh: &self.mesh,
            water_kind: &kind,
            ..passage
        })?;
        let mut water = flow_graph::gathered(
            coverage,
            &flow_targets,
            |cell| Ok(self.mesh.area(cell) * discharge.get(cell)?),
            |cell, received| passage.reference(cell, received, reference),
        )?;
        let reader = self.rivers.reader();
        let terrain = RiverTerrain {
            mesh: &self.mesh,
            water_kind: &kind,
            targets: &flow_targets,
        };
        let mut targets = coverage.scratch(self.mesh.len(), -1i32);
        let unit = super::ledger::depth_rate_to_discharge(reference, 1.0);
        for cell in 0..self.mesh.len() {
            let reach = reader.at(cell).filter(|reach| !reach.dry);
            let target = if reach.is_some() && kind.get(cell)? == 0 {
                reader
                    .successor(cell, reach, &terrain)?
                    .map(|target| target as i32)
                    .unwrap_or(-1)
            } else {
                flow_targets.get(cell)?
            };
            targets.set(cell, target)?;
            if reach.is_some() {
                water.set(cell, reader.water_at(cell, false, 0.0) / unit)?;
            }
        }
        Ok(SedimentRouting { targets, water })
    }
}
