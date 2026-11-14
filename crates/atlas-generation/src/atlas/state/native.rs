use super::State;
use crate::{
    atlas::{
        context::BoundPhysicalContext,
        environment::Environment,
        native::{NativeStep, NativeSteps},
        terrain::Terrain,
    },
    execution::ExecutionResult,
};

impl State {
    pub fn compose_authored_surface(&mut self) -> ExecutionResult<()> {
        self.physical.surface.compose_authored(
            &self.physical.protection.inputs,
            &self.scope.space,
            self.spatial.as_ref(),
        )?;
        Ok(())
    }
    pub fn restore_authored(&mut self, grounding: bool) -> ExecutionResult<()> {
        let physical = &mut self.physical;
        physical.executor.run_with(
            &crate::field::protection::restore(),
            &crate::field::protection::Restore {
                protection: &physical.protection,
                grounding: grounding.then_some(&physical.settings.glaciers),
            },
        )
    }
    pub fn select_physical_steps<'a>(
        &mut self,
        steps: &NativeSteps,
        environment: &Environment,
        terrain: &Terrain,
        seed: i32,
        selected: impl IntoIterator<Item = &'a str>,
    ) -> ExecutionResult<()> {
        let executor = &mut self.physical.executor;
        environment.select(executor, seed, |_| None);
        terrain.select(executor, seed, |_| None);
        steps.select(executor, seed, selected)
    }
    /// An occurrence uses its explicit ancestry and selected executable definition.
    pub fn apply_native_step(
        &mut self,
        step: &NativeStep,
        bound: &BoundPhysicalContext,
    ) -> ExecutionResult<()> {
        self.clear_queries();
        if step.kind().is_some() {
            self.restore_authored(true)?;
        }
        let result = step.run(&mut self.physical.executor, bound.context);
        self.clear_queries();
        result?;
        if step.kind().is_some() {
            self.restore_authored(true)?;
        }
        self.after_physical_step(step.name, bound.context.epoch_index)
    }
}
