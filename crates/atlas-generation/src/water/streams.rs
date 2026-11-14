use super::{guidance::GuidanceInputs, passage::PassageInputs, Water};
use crate::{
    flow_graph,
    storage::{Band, Coverage, ReadBand},
};
use std::io;
pub struct StreamRouting {
    targets: Band<i32>,
    water: Band<f64>,
}
impl StreamRouting {
    pub fn targets(&self) -> ReadBand<i32> {
        self.targets.read_only()
    }
    pub fn water(&self) -> ReadBand<f64> {
        self.water.read_only()
    }
}
impl Water {
    pub fn stream_routing(
        &mut self,
        guidance: GuidanceInputs<'_>,
        passage: PassageInputs<'_>,
        discharge: &ReadBand<f64>,
        reference: f64,
        coverage: &mut Coverage,
    ) -> io::Result<StreamRouting> {
        let targets = self
            .drainage
            .resolve_targets(guidance, &self.rivers, coverage)?;
        let passage = self.rivers.prepare_passage(passage)?;
        let water = flow_graph::gathered(
            coverage,
            &targets.read_only(),
            |cell| Ok(self.mesh.area(cell) * discharge.get(cell)?),
            |cell, amount| passage.reference(cell, amount, reference),
        )?;
        Ok(StreamRouting { targets, water })
    }
}
