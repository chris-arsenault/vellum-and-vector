//! Configured occurrences use the same command/query dispatcher as their owner algorithms.
pub mod preflight;
pub mod registration;
pub mod run;
pub mod specifications;
use super::{
    context::BoundPhysicalContext, history::GenerationEpoch, native::NativeStep, runtime::Runtime,
    state::State,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, ExecutionResult, Executor, Query},
    parameters::{Definitions, Values},
    products::{ProductContract, ProductDefinition},
    recipe::{self, random::Streams},
};
use std::{cell::RefCell, collections::BTreeMap, io, rc::Rc};

pub struct Input {
    pub parameters: Values,
    pub physical: BoundPhysicalContext,
    pub epochs: Vec<GenerationEpoch>,
    pub epoch_indices: Vec<usize>,
    pub random: Rc<RefCell<Streams>>,
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
}
impl Specification {
    pub fn new(id: &str, requires: &str, produces: &str, workspace_only: bool) -> Self {
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
        }
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
    pub fn native(contract: ProductContract) -> io::Result<Self> {
        Ok(Self {
            contract,
            parameters: serde_json::from_value(serde_json::json!({
                "initial": {"type":"boolean", "unit":null, "required":false, "default":false},
                "workSpan": {"type":"number", "unit":null, "required":false, "default":1}
            }))?,
            workspace_only: true,
            duration: None,
        })
    }
}
type Execute = dyn Fn(&mut Runtime, &Input) -> ExecutionResult<()>;
type Select = dyn Fn(&mut Executor<State>);
pub struct Process {
    pub specification: Specification,
    pub salt: i32,
    execute: Box<Execute>,
    select: Option<Box<Select>>,
}
impl Process {
    /// Context setup may install query strategies on the enclosing map execution scope.
    pub fn setup(
        specification: Specification,
        execute: impl Fn(&mut Runtime, &Input) -> ExecutionResult<()> + 'static,
    ) -> Self {
        Self {
            specification,
            salt: 0,
            execute: Box::new(execute),
            select: None,
        }
    }
    pub fn command<P: 'static>(
        specification: Specification,
        command: Command<State, P>,
        bind: impl Fn(&Input) -> ExecutionResult<P> + 'static,
    ) -> Self {
        Self {
            specification,
            salt: 0,
            select: None,
            execute: Box::new(move |runtime, input| {
                let value = bind(input)?;
                runtime
                    .executor
                    .run_with_context(&command, &value, Rc::new(input.physical.context))
            }),
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
            execute: Box::new(move |runtime, input| {
                runtime
                    .executor
                    .query_with_context(&query, Rc::new(input.physical.context))
                    .map(|_| ())
            }),
        }
    }
    pub fn native(step: NativeStep) -> io::Result<Self> {
        let specification = Specification::native(step.contract.clone())?;
        Ok(Self {
            specification,
            salt: step.salt,
            select: None,
            execute: Box::new(move |runtime, input| {
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
            }),
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
        let result = (self.execute)(runtime, input);
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
    pub fn register(&mut self, process: Process) -> io::Result<()> {
        let contract = &process.specification.contract;
        let key = (contract.id.clone(), contract.version.clone());
        if self.processes.contains_key(&key) {
            return Err(io::Error::other(format!(
                "Process {}@{} is already registered",
                key.0, key.1
            )));
        }
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
    pub fn select(
        &self,
        configuration: &recipe::Configuration,
        runtime: &mut Runtime,
    ) -> ExecutionResult<()> {
        for stage in configuration
            .stages()
            .map_err(|error| ExecutionError::Failed(format!("{error:?}")))?
        {
            if let crate::sequence::StageKind::Process(call) = stage.kind {
                let process = self.get(call)?;
                if call.enabled(&stage.context) {
                    if let Some(select) = &process.select {
                        select(&mut runtime.executor);
                    }
                }
            }
        }
        Ok(())
    }
}
