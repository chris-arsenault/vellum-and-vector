use crate::{
    flow_graph::target_order,
    lattice::TriangularLattice,
    scale::{MapScale, RelativeMeasure},
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct RiverWarmth {
    warmth: Band<f64>,
}
pub struct WarmthInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub scale: &'a MapScale,
    pub targets: &'a ReadBand<i32>,
    pub orders: &'a ReadBand<u32>,
    pub kind: &'a ReadBand<u8>,
    pub forcing: &'a ReadBand<f64>,
}
impl RiverWarmth {
    pub(super) fn inherit(&mut self, cell: usize, value: f64) -> io::Result<()> {
        self.warmth.set(cell, value)
    }
    pub(super) fn transport_history(
        &mut self,
        plan: &crate::transport::scatter::ScalarTransport<'_>,
        scratch: &mut Band<f64>,
    ) -> io::Result<()> {
        plan.apply(
            &mut self.warmth,
            crate::transport::quantities::QuantityKind::Share,
            scratch,
        )
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            warmth: coverage.allocate(0.0),
        }
    }
    pub fn read_only(&self) -> ReadBand<f64> {
        self.warmth.read_only()
    }
    pub fn project(&mut self, input: WarmthInputs<'_>, coverage: &mut Coverage) -> io::Result<()> {
        let mut carried = coverage.scratch(input.mesh.len(), 0.0f64);
        let order = target_order(coverage, input.targets)?;
        let decay = input
            .scale
            .resolve(RelativeMeasure::length(0.015).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        for cell in 0..input.mesh.len() {
            self.warmth.set(cell, 0.0)?;
        }
        for at in 0..order.len() {
            let cell = order.get(at)? as usize;
            let warmth = carried.get(cell)?.max(input.forcing.get(cell)?.max(0.0));
            if warmth <= 1.0 {
                continue;
            }
            if input.orders.get(cell)? >= 1 && input.kind.get(cell)? == 0 {
                self.warmth.set(cell, warmth)?;
            }
            let Ok(target) = usize::try_from(input.targets.get(cell)?) else {
                continue;
            };
            if input.kind.get(target)? == 1 {
                continue;
            }
            let next = warmth * (-input.mesh.physical_distance(cell, target) / decay).exp();
            carried.set(target, carried.get(target)?.max(next))?;
        }
        Ok(())
    }
}
