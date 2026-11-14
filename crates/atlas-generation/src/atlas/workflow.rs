//! One cooperative run of the selected owner graph on either execution host.
use super::{
    assembly::{Inputs, Operations},
    dispatch::run::{Event, Observer, Run, Settings},
    features::Context,
    history::{Diagnostic, GenerationEpoch},
    runtime::Runtime,
    state::State,
    validation::{Ownership, SurfaceRules},
};
use crate::{
    control::{ControlError, GenerationControl, GenerationProgress},
    execution::{ExecutionError, ExecutionResult},
    products::ProductLedger,
    recipe::Configuration,
};
use std::future::Future;

pub enum Boundary<'a> {
    Epoch(&'a [GenerationEpoch]),
    Final,
}
/// Existing domain validation and publication belong to the application adapter. A completed
/// observation must finish copying/serializing its output before the next process mutates it.
pub trait Output {
    fn validate(&mut self, state: &State) -> ExecutionResult<()>;
    fn diagnostic(&mut self, _diagnostic: &Diagnostic) -> ExecutionResult<()> {
        Ok(())
    }
    fn completed(
        &mut self,
        state: &State,
        boundary: Boundary<'_>,
    ) -> impl Future<Output = ExecutionResult<()>>;
}
pub struct Prepared {
    pub state: State,
    pub operations: Inputs,
    pub configuration: Configuration,
    pub settings: Settings,
    pub facts: Vec<String>,
    pub surface_rules: SurfaceRules,
    pub interfaces: super::validation::interfaces::Rules,
}
pub struct Generation {
    runtime: Runtime,
    operations: Operations,
    configuration: Configuration,
    settings: Settings,
    products: ProductLedger,
    ownership: Ownership,
}
impl Generation {
    pub fn new(input: Prepared, features: &Context<'_>) -> ExecutionResult<Self> {
        let ownership = Ownership::new(
            &input.state.scope,
            input.operations.world.original.features.clone(),
            input.surface_rules,
            input.operations.cache.clone(),
            input.interfaces,
        )?;
        let mut runtime = Runtime::new(input.state);
        let operations = Operations::new(&mut runtime, features, input.operations)?;
        let products = ProductLedger::new(input.facts, operations.registry.products.clone())
            .map_err(|error| ExecutionError::Failed(format!("{error:?}")))?;
        let diagnostics = super::dispatch::preflight::inspect(
            &input.configuration,
            &operations.registry,
            products.clone(),
        );
        if !diagnostics.is_empty() {
            return Err(ExecutionError::Failed(
                diagnostics
                    .into_iter()
                    .map(|diagnostic| diagnostic.message)
                    .collect::<Vec<_>>()
                    .join("\n"),
            ));
        }
        Ok(Self {
            runtime,
            operations,
            configuration: input.configuration,
            settings: input.settings,
            products,
            ownership,
        })
    }
    /// No stage index or execution checkpoint is accepted. Only completed geography leaves a run.
    pub async fn run(
        mut self,
        control: &impl GenerationControl,
        output: &mut impl Output,
    ) -> ExecutionResult<Runtime> {
        control.check().map_err(control_error)?;
        let mut observer = Observations {
            control,
            output,
            ownership: &self.ownership,
        };
        observer.progress(&["prepare".into()], 0.0, "Validating inherited geography")?;
        observer.validate(self.runtime.executor.state())?;
        let mut run = Run::new(
            &self.configuration,
            &self.operations.registry,
            self.settings,
            self.products,
            &mut self.runtime,
        )?;
        loop {
            control.cooperate().await.map_err(control_error)?;
            match run.advance(&mut self.runtime, &mut observer)? {
                Event::Epoch { ancestry } => {
                    observer
                        .output
                        .completed(self.runtime.executor.state(), Boundary::Epoch(&ancestry))
                        .await?;
                }
                Event::Finished => {
                    observer
                        .output
                        .completed(self.runtime.executor.state(), Boundary::Final)
                        .await?;
                    control.check().map_err(control_error)?;
                    return Ok(self.runtime);
                }
                Event::Process | Event::Skipped => {}
            }
            control.check().map_err(control_error)?;
        }
    }
}
struct Observations<'a, C, O> {
    control: &'a C,
    output: &'a mut O,
    ownership: &'a Ownership,
}
impl<C: GenerationControl, O: Output> Observer for Observations<'_, C, O> {
    fn validate(&mut self, state: &State) -> ExecutionResult<()> {
        self.ownership.validate(state)?;
        self.output.validate(state)
    }
    fn cancelled(&self) -> ExecutionResult<bool> {
        self.control.cancelled().map_err(control_error)
    }
    fn progress(&mut self, path: &[String], fraction: f64, message: &str) -> ExecutionResult<()> {
        self.control
            .progress(&GenerationProgress {
                path: path.to_vec(),
                fraction,
                message: message.into(),
            })
            .map_err(control_error)
    }
    fn diagnostic(&mut self, diagnostic: &Diagnostic) -> ExecutionResult<()> {
        self.output.diagnostic(diagnostic)
    }
}
fn control_error(error: ControlError) -> ExecutionError {
    ExecutionError::Failed(match error {
        ControlError::Cancelled => "generation_cancelled: Generation was cancelled".into(),
        ControlError::Host(message) => message,
    })
}
