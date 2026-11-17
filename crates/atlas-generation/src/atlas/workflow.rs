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
use crate::checkpoint::{Archive, Recovery};
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
    /// Private recovery is separate from completed GIS publication and UI observations.
    pub async fn run(
        mut self,
        control: &impl GenerationControl,
        output: &mut impl Output,
        mut recovery: Option<&mut dyn Recovery>,
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
        if let Some(reader) = recovery
            .as_mut()
            .map(|recovery| recovery.open())
            .transpose()?
            .flatten()
        {
            self.operations.restore_bindings(&mut self.runtime)?;
            let mut reader = reader;
            transfer(
                &mut Archive::Load(&mut reader),
                &mut run,
                &mut self.runtime,
                &self.operations,
            )?;
            observer.validate(self.runtime.executor.state())?;
        }
        loop {
            control.cooperate().await.map_err(control_error)?;
            let event = run.advance(&mut self.runtime, &mut observer)?;
            let point = run.checkpoint_point().filter(|point| {
                *point != crate::checkpoint::Point::Publication || matches!(event, Event::Finished)
            });
            if let (Some(point), Some(recovery)) = (&point, recovery.as_mut()) {
                if let Err(error) = recovery.replace(point, &mut |writer| {
                    transfer(
                        &mut Archive::Save(writer),
                        &mut run,
                        &mut self.runtime,
                        &self.operations,
                    )
                    .map_err(|error| std::io::Error::other(format!("{error:?}")))
                }) {
                    observer.output.diagnostic(&Diagnostic {
                        code: "checkpoint_failed".into(),
                        message: format!("Could not replace recovery checkpoint: {error}"),
                        severity: super::history::Severity::Warning,
                        invocation: "checkpoint".into(),
                        resource: None,
                        process: "checkpoint".into(),
                        epochs: Vec::new(),
                        outcome: super::history::Outcome::Failed,
                    })?;
                }
            }
            // Regional development shows its land at the start and after each round, as a
            // world shows it after each epoch.
            if let Some(
                point @ (crate::checkpoint::Point::RegionalDetail
                | crate::checkpoint::Point::RegionalRound { .. }),
            ) = &point
            {
                let stage = [super::history::GenerationEpoch {
                    id: point.label(),
                    duration: 0.0,
                    parent_epoch: None,
                    variables: Default::default(),
                }];
                observer
                    .output
                    .completed(self.runtime.executor.state(), Boundary::Epoch(&stage))
                    .await?;
            }
            match event {
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
fn transfer(
    archive: &mut Archive<'_>,
    run: &mut Run<'_>,
    runtime: &mut Runtime,
    operations: &Operations,
) -> ExecutionResult<()> {
    archive.format("atlas-checkpoint:owner-state", 2)?;
    archive.label(if cfg!(target_endian = "little") {
        "little-endian"
    } else {
        "big-endian"
    })?;
    run.checkpoint(archive)?;
    let mut invocation = runtime.executor.invocation();
    archive.value("invocation", &mut invocation)?;
    if archive.loading() {
        runtime.executor.set_invocation(invocation);
    }
    let inner = match archive {
        Archive::Save(writer) => Archive::Save(&mut **writer),
        Archive::Load(reader) => Archive::Load(&mut **reader),
    };
    runtime.executor.run_with(
        &State::checkpoint_operation(),
        &std::cell::RefCell::new(inner),
    )?;
    operations.checkpoint(archive)?;
    archive.label("checkpoint-complete")?;
    Ok(())
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
