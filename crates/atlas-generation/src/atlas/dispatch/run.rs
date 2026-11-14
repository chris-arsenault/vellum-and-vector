//! Run-local sequence traversal; completed history and publication observations are the only boundaries.
use super::{Input, Registry};
use crate::{
    atlas::{
        context::{ContextSource, Epoch},
        history::{Cause, Diagnostic, EpochHistory, GenerationEpoch, Outcome, Severity},
        runtime::Runtime,
        state::State,
    },
    bindings::Invocation,
    execution::{Command, CommandKind, ExecutionError, ExecutionResult},
    products::ProductLedger,
    recipe::{random::Streams, Configuration, Stage},
    sequence::StageKind,
};
use std::{cell::RefCell, io, rc::Rc};

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub seed: String,
    pub seed_scope: String,
    pub physical_seed: i32,
    pub epochs: Vec<Epoch>,
}
pub trait Observer {
    fn validate(&mut self, state: &State) -> ExecutionResult<()>;
    fn cancelled(&self) -> ExecutionResult<bool> {
        Ok(false)
    }
    fn progress(
        &mut self,
        _path: &[String],
        _fraction: f64,
        _message: &str,
    ) -> ExecutionResult<()> {
        Ok(())
    }
    fn diagnostic(&mut self, _diagnostic: &Diagnostic) -> ExecutionResult<()> {
        Ok(())
    }
}
pub enum Event {
    Process,
    Skipped,
    Epoch { ancestry: Vec<GenerationEpoch> },
    Finished,
}
pub struct Run<'a> {
    configuration: &'a Configuration,
    registry: &'a Registry,
    stages: Vec<Stage<'a>>,
    settings: Settings,
    next: usize,
    pub products: ProductLedger,
    parents: Rc<RefCell<Vec<Vec<Cause>>>>,
}
impl<'a> Run<'a> {
    pub fn new(
        configuration: &'a Configuration,
        registry: &'a Registry,
        settings: Settings,
        products: ProductLedger,
        runtime: &mut Runtime,
    ) -> ExecutionResult<Self> {
        registry.select(configuration, runtime)?;
        let stages = configuration
            .stages()
            .map_err(|error| ExecutionError::Failed(format!("{error:?}")))?;
        Ok(Self {
            configuration,
            registry,
            stages,
            settings,
            next: 0,
            products,
            parents: Rc::default(),
        })
    }
    /// Hosts yield and serialize an epoch observation before calling again. Nothing here is persisted.
    pub fn advance(
        &mut self,
        runtime: &mut Runtime,
        observer: &mut impl Observer,
    ) -> ExecutionResult<Event> {
        if observer.cancelled()? {
            return Err(ExecutionError::Failed(
                "generation_cancelled: Generation was cancelled".into(),
            ));
        }
        let Some(stage) = self.stages.get(self.next) else {
            observer.progress(&["finalize".into()], 0.99, "Validating completed geography")?;
            observer.validate(runtime.executor.state())?;
            return Ok(Event::Finished);
        };
        let stage = Stage {
            kind: match stage.kind {
                StageKind::Process(call) => StageKind::Process(call),
                StageKind::EpochStart(reset) => StageKind::EpochStart(reset),
                StageKind::EpochEnd => StageKind::EpochEnd,
            },
            context: stage.context.clone(),
        };
        let event = match &stage.kind {
            StageKind::EpochStart(reset) => {
                let parents = self.parents.clone();
                runtime.executor.run(&Command::new(
                    "history.begin-epoch",
                    CommandKind::Event,
                    vec![],
                    move |state: &mut State, _| {
                        parents.borrow_mut().push(std::mem::take(&mut state.causes));
                        Ok(())
                    },
                ))?;
                self.products.enter_epoch(&stage.context.path.join("/"));
                for fact in *reset {
                    self.products.invalidate(fact, "epoch reset");
                }
                Event::Process
            }
            StageKind::EpochEnd => {
                let ancestry = ancestry(&stage);
                let history = EpochHistory {
                    path: stage.context.path.clone(),
                    ancestry: ancestry.clone(),
                    causes: Vec::new(),
                };
                let parents = self.parents.clone();
                runtime.executor.run(&Command::new(
                    "history.complete-epoch",
                    CommandKind::Event,
                    vec![],
                    move |state: &mut State, _| {
                        let mut history = history.clone();
                        history.causes = std::mem::take(&mut state.causes);
                        state.history.push(history);
                        state.causes = parents
                            .borrow_mut()
                            .pop()
                            .ok_or_else(|| io::Error::other("Epoch ancestry is unbalanced"))?;
                        Ok(())
                    },
                ))?;
                self.products.enter_epoch(&stage.context.path.join("/"));
                observer.validate(runtime.executor.state())?;
                Event::Epoch { ancestry }
            }
            StageKind::Process(call) => self.process(runtime, observer, &stage, call)?,
        };
        self.next += 1;
        if observer.cancelled()? {
            return Err(ExecutionError::Failed(
                "generation_cancelled: Generation was cancelled".into(),
            ));
        }
        Ok(event)
    }
    fn process(
        &mut self,
        runtime: &mut Runtime,
        observer: &mut impl Observer,
        stage: &Stage<'_>,
        call: &crate::recipe::Invocation,
    ) -> ExecutionResult<Event> {
        if !call.enabled(&stage.context) {
            observer.progress(
                &stage.context.path,
                (self.next + 1) as f64 / self.stages.len() as f64 * 0.98,
                &format!("Skipped {}", call.process),
            )?;
            return Ok(Event::Skipped);
        }
        let process = self.registry.get(call)?;
        process.validate_binding(stage.context.duration())?;
        let contract = &process.specification.contract;
        let missing = self.products.missing(contract);
        if !missing.is_empty() {
            for resource in missing {
                record(
                    runtime,
                    observer,
                    Diagnostic {
                        code: "stale_fact".into(),
                        message: format!(
                            "Skipped {}: requires {resource}, which no selected step has written.",
                            contract.id
                        ),
                        severity: Severity::Warning,
                        invocation: stage.context.path.join("/"),
                        resource: Some(resource.into()),
                        process: contract.id.clone(),
                        epochs: ancestry(stage),
                        outcome: Outcome::Skipped,
                    },
                )?;
            }
            observer.progress(
                &stage.context.path,
                (self.next + 1) as f64 / self.stages.len() as f64 * 0.98,
                &format!("Skipped {}", contract.id),
            )?;
            return Ok(Event::Skipped);
        }
        let parameters = self.configuration.invocation_parameters(
            &process.specification.parameters,
            call,
            &stage.context,
        )?;
        self.products
            .check_providers(contract)
            .map_err(|error| ExecutionError::Failed(format!("{error:?}")))?;
        let state = runtime.executor.state();
        let physical = ContextSource {
            epochs: &self.settings.epochs,
            scale: state.field().scale(),
            initialized: state.field().ground().support_initialized(),
        }
        .bind(
            self.settings.physical_seed,
            process.salt,
            &state.physical.settings.profile,
            &stage.context,
        )
        .map_err(|error| ExecutionError::Failed(format!("{error:?}")))?;
        runtime.executor.set_invocation(Invocation {
            world_seed: self.settings.physical_seed,
            epoch_index: physical.epoch.map_or(-1, |epoch| epoch as i32),
            step_salt: process.salt,
            epoch_duration: stage.context.duration(),
            exposure: physical.context.span,
        });
        let input = Input {
            parameters,
            physical,
            epochs: ancestry(stage),
            epoch_indices: stage.context.epoch_indices.clone(),
            random: Rc::new(RefCell::new(Streams::new(
                &self.settings.seed,
                &self.settings.seed_scope,
                &stage.context,
            ))),
        };
        let fraction = self.next as f64 / self.stages.len() as f64 * 0.98;
        observer.progress(
            &stage.context.path,
            fraction,
            &format!("Starting {}", contract.id),
        )?;
        let applied = (|| -> ExecutionResult<()> {
            process.execute(runtime, &input)?;
            if !process.specification.workspace_only {
                runtime.executor.run(&Command::new(
                    "atlas.compose-authored-surface",
                    CommandKind::Event,
                    vec![],
                    |state: &mut State, _| state.compose_authored_surface(),
                ))?;
                observer.validate(runtime.executor.state())?;
            }
            self.products
                .commit(contract, &stage.context.path.join("/"))
                .map_err(|error| ExecutionError::Failed(format!("{error:?}")))
        })();
        if let Err(error) = applied {
            if observer.cancelled()? {
                return Err(ExecutionError::Failed(
                    "generation_cancelled: Generation was cancelled".into(),
                ));
            }
            record(
                runtime,
                observer,
                Diagnostic {
                    code: "process_failed".into(),
                    message: match &error {
                        ExecutionError::Failed(message) => message.clone(),
                        _ => format!("{error:?}"),
                    },
                    severity: Severity::Error,
                    invocation: stage.context.path.join("/"),
                    resource: None,
                    process: contract.id.clone(),
                    epochs: ancestry(stage),
                    outcome: Outcome::Failed,
                },
            )?;
            return Err(error);
        }
        observer.progress(
            &stage.context.path,
            (self.next + 1) as f64 / self.stages.len() as f64 * 0.98,
            &format!("Completed {}", contract.id),
        )?;
        Ok(Event::Process)
    }
}
fn record(
    runtime: &mut Runtime,
    observer: &mut impl Observer,
    diagnostic: Diagnostic,
) -> ExecutionResult<()> {
    let entry = diagnostic.clone();
    runtime.executor.run(&Command::new(
        "history.process-diagnostic",
        CommandKind::Event,
        vec![],
        move |state: &mut State, _| {
            state.diagnostics.push(entry.clone());
            Ok(())
        },
    ))?;
    observer.diagnostic(&diagnostic)
}
fn ancestry(stage: &Stage<'_>) -> Vec<GenerationEpoch> {
    stage
        .context
        .epochs
        .iter()
        .map(|epoch| GenerationEpoch {
            id: epoch.id.clone(),
            duration: epoch.duration,
            parent_epoch: epoch.parent_epoch.clone(),
            variables: epoch.variables.clone(),
        })
        .collect()
}
