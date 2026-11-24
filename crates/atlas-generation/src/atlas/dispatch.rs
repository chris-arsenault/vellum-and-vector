//! Configured occurrences use the same command/query dispatcher as their owner algorithms.
mod metadata;
pub mod preflight;
mod publication;
pub mod registration;
pub mod run;
mod schedule;
pub mod specifications;
use super::{
    context::BoundPhysicalContext, history::GenerationEpoch, native::NativeStep, runtime::Runtime,
    state::State,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, ExecutionResult, Executor, Query},
    parameters::{Definitions, Values},
    processes::strategies::{EffectTime, Site, Source, Strategy, Timing},
    products::{ProductContract, ProductDefinition},
    recipe::{self, random::Streams},
};
pub use metadata::{Category, Feedback, Legacy, Schedule, SemanticRegistration};
pub use publication::{Publication, Publish};
use std::{cell::RefCell, collections::BTreeMap, io, rc::Rc};

pub struct Input {
    pub parameters: Values,
    pub physical: BoundPhysicalContext,
    pub epochs: Vec<GenerationEpoch>,
    pub epoch_indices: Vec<usize>,
    pub random: Rc<RefCell<Streams>>,
    pub site: Site,
}
impl Input {
    pub fn number(&self, key: &str) -> io::Result<f64> {
        self.parameters
            .get(key)
            .and_then(serde_json::Value::as_f64)
            .ok_or_else(|| io::Error::other(format!("Process requires numeric parameter {key}")))
    }
    pub fn flag(&self, key: &str) -> io::Result<bool> {
        self.parameters
            .get(key)
            .and_then(serde_json::Value::as_bool)
            .ok_or_else(|| io::Error::other(format!("Process requires boolean parameter {key}")))
    }
}
#[derive(Clone)]
pub struct Specification {
    pub contract: ProductContract,
    pub parameters: Definitions,
    pub workspace_only: bool,
    pub duration: Option<crate::bindings::DurationBinding>,
    pub category: Category,
    pub module: &'static str,
    pub schedule: Schedule,
}
impl Specification {
    #[track_caller]
    pub fn new(id: &str, requires: &str, produces: &str, workspace_only: bool) -> Self {
        let declared_at = std::panic::Location::caller();
        Self {
            contract: ProductContract {
                id: id.into(),
                version: "1".into(),
                requires: requires.split_whitespace().map(str::to_owned).collect(),
                produces: produces.split_whitespace().map(str::to_owned).collect(),
                invalidates: Vec::new(),
            },
            parameters: Definitions::new(),
            workspace_only,
            duration: None,
            // owner-direction(2026-11-23): the spreadsheet determines migration and existing registrations stay legacy until migrated
            category: Category::LegacyUnmigrated(Legacy { declared_at }),
            module: declared_at.file(),
            schedule: Schedule::default(),
        }
    }
    pub fn publication(mut self) -> Self {
        self.category = Category::ClassificationPublication;
        self
    }
    pub fn scheduled(mut self, module: &'static str, schedule: Schedule) -> Self {
        self.module = module;
        self.schedule = schedule;
        self
    }
    fn strategy(
        &self,
        site: Site,
        stage: &recipe::Stage<'_>,
    ) -> io::Result<Vec<metadata::Selected>> {
        let Category::Semantic(semantic) = &self.category else {
            return Ok(Vec::new());
        };
        let elapsed = stage
            .context
            .duration()
            .is_some_and(|duration| duration > 0.0);
        let selected = semantic.select(site, elapsed)?;
        if selected
            .iter()
            .any(|strategy| strategy.time == EffectTime::SpatialIteration)
            && stage
                .context
                .epochs
                .iter()
                .any(|epoch| epoch.duration > 0.0)
        {
            return Err(io::Error::other(format!(
                "{} cannot run a spatial strategy in elapsed history",
                self.contract.id
            )));
        }
        Ok(selected)
    }
    pub(super) fn active(&self, site: Site, stage: &recipe::Stage<'_>) -> io::Result<bool> {
        Ok(!matches!(self.category, Category::Semantic(_))
            || !self.strategy(site, stage)?.is_empty())
    }
    fn validate_strategies(&self) -> io::Result<()> {
        if let Category::Semantic(owner) = &self.category {
            (owner.validate)()?;
        }
        Ok(())
    }
    pub fn elapsed(mut self, binding: crate::bindings::DurationBinding) -> Self {
        self.duration = Some(binding);
        self
    }
    pub fn validate_binding(&self, duration: Option<f64>) -> io::Result<()> {
        if let Some(binding) = self.duration {
            binding.years(duration).map_err(io::Error::other)?;
        }
        Ok(())
    }
    #[track_caller]
    pub fn native(contract: ProductContract) -> io::Result<Self> {
        let mut specification = Self::new(&contract.id, "", "", true);
        specification.contract = contract;
        specification.module = "atlas/native";
        specification.parameters = serde_json::from_value(serde_json::json!({
            "initial": {"type":"boolean", "unit":null, "required":false, "default":false},
            "workSpan": {"type":"number", "unit":null, "required":false, "default":1}
        }))?;
        Ok(specification)
    }
}
type Execute = dyn Fn(&mut Runtime, &Input) -> ExecutionResult<()>;
type Select = dyn Fn(&mut Executor<State>);
enum Operation {
    Legacy(Box<Execute>),
    Semantic(Box<Execute>),
    Publication(Command<State, Input>),
}
pub struct Process {
    specification: Specification,
    pub salt: i32,
    operation: Operation,
    select: Option<Box<Select>>,
    source_command: String,
    registered_at: Option<&'static std::panic::Location<'static>>,
}
impl Process {
    /// Context setup may install query strategies on the enclosing map execution scope.
    pub fn setup(
        specification: Specification,
        execute: impl Fn(&mut Runtime, &Input) -> ExecutionResult<()> + 'static,
    ) -> Self {
        let source_command = specification.contract.id.clone();
        Self {
            specification,
            salt: 0,
            operation: Operation::Legacy(Box::new(execute)),
            select: None,
            source_command,
            registered_at: None,
        }
    }
    pub fn command<P: 'static>(
        specification: Specification,
        command: Command<State, P>,
        bind: impl Fn(&Input) -> ExecutionResult<P> + 'static,
    ) -> Self {
        let source_command = command.name().into();
        let execute = Self::bound_command(command, bind);
        Self {
            specification,
            salt: 0,
            select: None,
            source_command,
            registered_at: None,
            operation: Operation::Legacy(execute),
        }
    }
    fn bound_command<P: 'static>(
        command: Command<State, P>,
        bind: impl Fn(&Input) -> ExecutionResult<P> + 'static,
    ) -> Box<Execute> {
        Box::new(move |runtime, input| {
            let value = bind(input)?;
            runtime
                .executor
                .run_with_context(&command, &value, Rc::new(input.physical.context))
        })
    }
    pub fn publication(specification: Specification, publish: Publish) -> Self {
        let id = specification.contract.id.clone();
        Self {
            specification: specification.publication(),
            salt: 0,
            select: None,
            operation: Operation::Publication(publication::command(&id, publish)),
            source_command: id,
            registered_at: None,
        }
    }
    pub fn semantic_command<
        P: 'static,
        A: Copy + 'static,
        I: Source + Copy + 'static,
        B: Source + Copy + 'static,
    >(
        registration: &SemanticRegistration<A, I, B>,
        command: Command<State, P>,
        bind: impl Fn(&Input, Strategy<A, I, B>) -> ExecutionResult<P> + 'static,
    ) -> Self {
        let owner = registration.owner;
        let source_command = command.name().into();
        let execute = Box::new(move |runtime: &mut Runtime, input: &Input| {
            let elapsed = input
                .epochs
                .last()
                .is_some_and(|epoch| epoch.duration > 0.0);
            let timing = if elapsed {
                Timing::Elapsed
            } else {
                Timing::Present
            };
            for strategy in owner.select(input.site, timing)? {
                let value = bind(input, strategy)?;
                runtime.executor.run_with_context(
                    &command,
                    &value,
                    Rc::new(input.physical.context),
                )?;
            }
            Ok(())
        });
        Self {
            specification: registration.specification(),
            salt: 0,
            select: None,
            operation: Operation::Semantic(execute),
            source_command,
            registered_at: None,
        }
    }
    pub fn unit(specification: Specification, command: Command<State>) -> Self {
        Self::command(specification, command, |_| Ok(()))
    }
    pub fn query(specification: Specification, query: Query<State, ()>) -> Self {
        let selected = query.clone();
        Self {
            specification,
            salt: 0,
            select: Some(Box::new(move |executor| executor.select(&selected))),
            source_command: query.name().into(),
            registered_at: None,
            operation: Operation::Legacy(Box::new(move |runtime, input| {
                runtime
                    .executor
                    .query_with_context(&query, Rc::new(input.physical.context))
                    .map(|_| ())
            })),
        }
    }
    #[track_caller]
    pub fn native(step: NativeStep) -> io::Result<Self> {
        let specification = Specification::native(step.contract.clone())?;
        Ok(Self {
            specification,
            salt: step.salt,
            select: None,
            source_command: step.name.into(),
            registered_at: None,
            operation: Operation::Legacy(Box::new(move |runtime, input| {
                let regional = runtime.executor.state().regional.is_some();
                let mut context = input.physical.context;
                context.span = if step.kind() == Some(CommandKind::Work) {
                    if regional {
                        crate::bindings::work_exposure(input.number("workSpan")?)
                            .map_err(io::Error::other)?
                    } else {
                        context.span
                    }
                } else {
                    0.0
                };
                context.local_development = Some(regional && context.span > 0.0);
                if input.flag("initial")? {
                    context.epoch_index = 0;
                    context.seed =
                        runtime.executor.invocation().world_seed ^ step.salt ^ 0x045d_9f3b;
                }
                runtime.apply_native(
                    &step,
                    &BoundPhysicalContext {
                        context,
                        profile: input.physical.profile.clone(),
                        epoch: input.physical.epoch,
                    },
                )
            })),
        })
    }
    pub fn elapsed(mut self, binding: crate::bindings::DurationBinding) -> Self {
        self.specification.duration = Some(binding);
        self
    }
    pub fn validate_binding(&self, duration: Option<f64>) -> io::Result<()> {
        self.specification.validate_binding(duration)
    }
    fn execute(&self, runtime: &mut Runtime, input: &Input) -> ExecutionResult<()> {
        runtime.executor.state().clear_queries();
        let field_start = runtime.executor.state().field().begin_process();
        let surface_start = runtime.executor.state().physical.surface.begin_process();
        let result = match &self.operation {
            Operation::Legacy(run) | Operation::Semantic(run) => run(runtime, input),
            Operation::Publication(command) => runtime.executor.run_with(command, input),
        };
        runtime.executor.state().clear_queries();
        runtime
            .executor
            .state()
            .field()
            .release_process(field_start);
        runtime.executor.run(&Command::new(
            "atlas.release-process-scratch",
            CommandKind::Event,
            vec![],
            move |state: &mut State, _| {
                state.physical.surface.release_process(surface_start);
                Ok(())
            },
        ))?;
        result
    }
}
#[derive(Default)]
pub struct Registry {
    processes: BTreeMap<(String, String), Process>,
    pub products: Vec<ProductDefinition>,
}
impl Registry {
    #[track_caller]
    pub fn register(&mut self, mut process: Process) -> io::Result<()> {
        process.specification.validate_strategies()?;
        let contract = &process.specification.contract;
        if !matches!(
            (&process.specification.category, &process.operation),
            (Category::LegacyUnmigrated(_), Operation::Legacy(_))
                | (Category::Semantic(_), Operation::Semantic(_))
                | (
                    Category::ClassificationPublication,
                    Operation::Publication(_)
                )
        ) {
            return Err(io::Error::other(format!(
                "{} requires an executable {} operation",
                contract.id,
                process.specification.category.name()
            )));
        }
        let key = (contract.id.clone(), contract.version.clone());
        if self.processes.contains_key(&key) {
            return Err(io::Error::other(format!(
                "Process {}@{} is already registered",
                key.0, key.1
            )));
        }
        process.registered_at = Some(std::panic::Location::caller());
        self.processes.insert(key, process);
        Ok(())
    }
    pub fn get(&self, call: &recipe::Invocation) -> ExecutionResult<&Process> {
        self.processes
            .get(&(call.process.clone(), call.version.clone()))
            .ok_or_else(|| {
                ExecutionError::Failed(format!("Unknown process {}@{}", call.process, call.version))
            })
    }
    pub fn inventory(&self) -> impl Iterator<Item = (&Specification, &str)> {
        self.processes
            .values()
            .map(|process| (&process.specification, process.source_command.as_str()))
    }
    fn trace_inventory(&self) {
        for process in self.processes.values() {
            let specification = &process.specification;
            let legacy = match specification.category {
                Category::LegacyUnmigrated(legacy) => Some(serde_json::json!({
                    "declaration": legacy.declared_at.to_string(),
                })),
                _ => None,
            };
            eprintln!(
                "{}",
                serde_json::json!({
                    "event": "generation.registry.entry", "id": specification.contract.id,
                    "version": specification.contract.version, "category": specification.category.name(),
                "module": specification.module, "command": process.source_command, "legacy": legacy,
                "registeredAt": process.registered_at.map(ToString::to_string),
                    "stage": specification.schedule.stage, "order": specification.schedule.order,
                    "after": specification.schedule.after,
                    "feedback": specification.schedule.feedback.map(|group| group.name),
                })
            );
        }
    }
    pub fn select(
        &self,
        stages: &[recipe::Stage<'_>],
        runtime: &mut Runtime,
    ) -> ExecutionResult<()> {
        let site = runtime.executor.state().field().process_site();
        for stage in stages {
            if let crate::sequence::StageKind::Process(call) = stage.kind {
                let process = self.get(call)?;
                if call.enabled(&stage.context) && process.specification.active(site, stage)? {
                    if let Some(select) = &process.select {
                        select(&mut runtime.executor);
                    }
                }
            }
        }
        Ok(())
    }
}
