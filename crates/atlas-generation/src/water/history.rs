use super::Water;
use crate::{storage::Band, transport::scatter::ScalarTransport};
use std::io;
impl Water {
    pub fn transport_history(
        &mut self,
        plan: &ScalarTransport<'_>,
        scratch: &mut Band<f64>,
    ) -> io::Result<()> {
        self.column.borrow_mut().transport_memory(plan, scratch)?;
        self.warmth.transport_history(plan, scratch)
    }
}
