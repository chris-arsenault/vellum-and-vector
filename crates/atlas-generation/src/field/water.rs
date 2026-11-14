//! Store import and lifecycle commands, and derived reads, use the same opaque dispatcher.
pub mod channels;
pub mod deltas;
pub mod drainage;
pub mod network;
pub mod publication;
mod responders;
pub use responders::respond;
mod ocean;
pub mod streams;
pub mod transfers;
use super::Field;
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query},
    water::{
        captured::RetainedNetwork,
        column::{CapturedColumn, WaterColumnView},
        runoff::RunoffView,
    },
};
pub use ocean::Budget as OceanBudget;
use std::io;
impl crate::execution::QueryValue for RunoffView {}
pub struct InheritWater {
    pub cell: usize,
    pub column: CapturedColumn,
    pub year: [f64; 14],
}
pub struct MeltReceipt {
    pub cell: usize,
    pub depth: f64,
}
pub struct WaterOperations {
    pub inherit: Command<Field, InheritWater>,
    pub restore_network: Command<Field, RetainedNetwork>,
    pub begin_epoch: Command<Field>,
    pub receive_melt: Command<Field, MeltReceipt>,
    pub column: Query<Field, WaterColumnView>,
    pub runoff: Query<Field, RunoffView>,
}
fn failure(error: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
fn command<P: 'static>(
    id: &str,
    kind: CommandKind,
    apply: impl Fn(&mut crate::water::Water, &P) -> io::Result<()> + 'static,
) -> Command<Field, P> {
    Command::with_inputs(id, kind, vec![], move |context, input| {
        let mut water = context
            .state_mut()
            .water
            .try_borrow_mut()
            .map_err(failure)?;
        apply(&mut water, input).map_err(failure)
    })
}
impl WaterOperations {
    pub fn new() -> Self {
        Self {
            inherit: command(
                "water.column.inherit",
                CommandKind::Initialize,
                |water, value: &InheritWater| {
                    water.inherit_column(value.cell, value.column, value.year)
                },
            ),
            restore_network: command(
                "water.network.restore",
                CommandKind::Initialize,
                |water, network| water.restore_network(network),
            ),
            begin_epoch: command("water.begin-epoch", CommandKind::Initialize, |water, _| {
                water.begin_epoch()
            }),
            receive_melt: command(
                "water.receive-melt",
                CommandKind::Work,
                |water, receipt: &MeltReceipt| water.receive_melt(receipt.cell, receipt.depth),
            ),
            column: Query::new("water.column", vec![], |field: &Field, _| {
                Ok(field.water().column)
            }),
            runoff: Query::new("runoff", vec![], |field: &Field, _| {
                let mut water = field.water.try_borrow_mut().map_err(failure)?;
                water.project_runoff().map_err(failure)?;
                Ok(water.read_only().runoff)
            }),
        }
    }
}
impl Default for WaterOperations {
    fn default() -> Self {
        Self::new()
    }
}
