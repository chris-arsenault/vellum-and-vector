use super::{Ground, GroundField};
use crate::{
    storage::Band,
    transport::{quantities::QuantityKind, scatter::ScalarTransport},
};
use std::io;
impl Ground {
    pub fn transport_history(
        &mut self,
        plan: &ScalarTransport<'_>,
        scratch: &mut Band<f64>,
    ) -> io::Result<()> {
        for field in [GroundField::SoilDepth, GroundField::CumulativeDeposition] {
            plan.apply(
                &mut self.storage.bands[field as usize],
                QuantityKind::Amount,
                scratch,
            )?;
        }
        Ok(())
    }
}
