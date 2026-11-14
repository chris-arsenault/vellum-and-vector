use super::HumanLayers;
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    storage::{Band, Coverage, ReadBand},
    transport::{
        quantities::QuantityKind,
        scatter::{area_weights, ScalarTransport},
        HistoryTransport,
    },
};
use std::io;
type Access<S> = fn(&mut S) -> (&mut HumanLayers, &mut Coverage, ReadBand<i32>);
pub fn transport_records<S: 'static>(access: Access<S>) -> Command<S, HistoryTransport> {
    Command::with_inputs(
        "human.history.transport",
        CommandKind::Event,
        vec![],
        move |context, plan: &HistoryTransport| {
            let (owner, coverage, boundaries) = access(context.state_mut());
            let result = (|| {
                let weights = area_weights(coverage, &plan.shares, |cell| owner.mesh.area(cell))?;
                let mut scratch = coverage.scratch(owner.mesh.len(), 0.0);
                owner.transport_history(
                    &ScalarTransport {
                        shares: &plan.shares,
                        arrivals: &plan.arrivals,
                        boundaries: &boundaries,
                        weights: &weights.read_only(),
                    },
                    &mut scratch,
                )
            })();
            result.map_err(|error: io::Error| ExecutionError::Failed(error.to_string()))
        },
    )
}
impl HumanLayers {
    fn transport_history(
        &mut self,
        plan: &ScalarTransport<'_>,
        scratch: &mut Band<f64>,
    ) -> io::Result<()> {
        for (index, values) in self.records.iter_mut().enumerate() {
            plan.apply(
                values,
                if index == 3 {
                    QuantityKind::Share
                } else {
                    QuantityKind::Amount
                },
                scratch,
            )?;
        }
        Ok(())
    }
}
