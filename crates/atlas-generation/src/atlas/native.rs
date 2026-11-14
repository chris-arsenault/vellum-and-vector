//! Reusable executable definitions; feature contributions choose their occurrences and order.
mod definitions;
use crate::{
    bindings::physical_seeds,
    execution::{
        Command, CommandContext, CommandKind, ExecutionError, ExecutionResult, Executor,
        Projection, Query, QueryValue, Selection,
    },
    field::Field,
    processes::runner::PhysicalContext,
};
use std::rc::Rc;

#[derive(Clone)]
enum Operation {
    Query(Query<Field, ()>),
    Command(Command<Field, PhysicalContext>),
}
type ProviderSelection = Rc<dyn Fn(&mut Selection<'_, Field>, i32, i32)>;
#[derive(Clone)]
struct Part {
    operation: Operation,
    select: Option<ProviderSelection>,
}
impl Part {
    fn query<T: QueryValue>(query: &Query<Field, T>) -> Self {
        let provider = query.clone();
        let selected = query.clone();
        Self {
            operation: Operation::Query(Query::new(query.name(), vec![], move |_, read| {
                read.get(&provider).map(|_| ())
            })),
            select: Some(Rc::new(move |executor, seed, salt| {
                executor.select_with_input(&selected, move |input: &PhysicalContext| {
                    let seeds = physical_seeds(seed, salt, input.epoch_index);
                    PhysicalContext {
                        seed: seeds.seed,
                        epoch_stable_seed: seeds.epoch_stable_seed,
                        span: 0.0,
                        local_development: Some(false),
                        ..*input
                    }
                });
            })),
        }
    }
    fn command<P: 'static>(
        command: &Command<Field, P>,
        input: impl Fn(&PhysicalContext) -> P + 'static,
    ) -> Self {
        let child = command.clone();
        Self {
            operation: Operation::Command(Command::with_inputs(
                command.name(),
                command.kind(),
                vec![],
                move |scope, context: &PhysicalContext| scope.run(&child, &input(context)),
            )),
            select: None,
        }
    }
    fn physical(command: &Command<Field, PhysicalContext>) -> Self {
        Self::command(command, |context| *context)
    }
    fn unit(command: &Command<Field>) -> Self {
        Self::command(command, |_| ())
    }
}

/// The body stays behind the same dispatcher as each constituent process.
#[derive(Clone)]
pub struct NativeStep {
    pub name: &'static str,
    pub salt: i32,
    operation: Operation,
    parts: Vec<Part>,
    pub contract: crate::products::ProductContract,
}
pub(super) struct Declaration {
    pub needs: &'static str,
    pub writes: &'static str,
    pub leaves: &'static str,
}
impl Declaration {
    fn contract(&self, name: &str) -> crate::products::ProductContract {
        crate::products::ProductContract {
            id: format!("atlas.{name}"),
            version: "1".into(),
            requires: std::iter::once("atlas:workspace".into())
                .chain(
                    self.needs
                        .split_whitespace()
                        .map(|name| format!("field:{name}")),
                )
                .collect(),
            produces: self
                .writes
                .split_whitespace()
                .map(|name| format!("field:{name}"))
                .chain(self.leaves.split_whitespace().map(str::to_owned))
                .collect(),
            invalidates: Vec::new(),
        }
    }
}
pub fn contracts() -> Vec<crate::products::ProductContract> {
    definitions::contracts()
}
impl NativeStep {
    fn new(
        name: &'static str,
        salt: i32,
        declared: Declaration,
        parts: Vec<Part>,
    ) -> ExecutionResult<Self> {
        let kinds: Vec<_> = parts
            .iter()
            .filter_map(|part| match &part.operation {
                Operation::Query(_) => None,
                Operation::Command(command) => Some(command.kind()),
            })
            .collect();
        let children = parts.clone();
        let operation = if kinds.is_empty() {
            Operation::Query(Query::new(name, vec![], move |_, read| {
                for part in &children {
                    if let Operation::Query(query) = &part.operation {
                        read.get(query)?;
                    }
                }
                Ok(())
            }))
        } else {
            let kind = if kinds.contains(&CommandKind::Work) {
                CommandKind::Work
            } else if kinds.contains(&CommandKind::Event) {
                CommandKind::Event
            } else if kinds.iter().all(|kind| *kind == CommandKind::Initialize) {
                CommandKind::Initialize
            } else {
                return Err(ExecutionError::Failed(format!(
                    "Unsupported native lifecycle composition: {name}"
                )));
            };
            Operation::Command(Command::with_inputs(
                name,
                kind,
                vec![],
                move |scope, context| {
                    for part in &children {
                        match &part.operation {
                            Operation::Query(query) => {
                                scope.query(query)?;
                            }
                            Operation::Command(command) => scope.run(command, context)?,
                        }
                    }
                    Ok(())
                },
            ))
        };
        Ok(Self {
            name,
            salt,
            operation,
            parts,
            contract: declared.contract(name),
        })
    }
    pub fn kind(&self) -> Option<CommandKind> {
        match &self.operation {
            Operation::Query(_) => None,
            Operation::Command(command) => Some(command.kind()),
        }
    }
    /// Bind only the providers owned by a selected feature's executable steps.
    pub fn select(&self, executor: &mut Executor<Field>, seed: i32) {
        self.select_in(&mut executor.selection(), seed);
    }
    pub fn select_in(&self, executor: &mut Selection<'_, Field>, seed: i32) {
        for part in &self.parts {
            if let Some(select) = &part.select {
                select(executor, seed, self.salt);
            }
            if let Operation::Query(query) = &part.operation {
                executor.select(query);
            }
        }
        if let Operation::Query(query) = &self.operation {
            executor.select(query);
        }
    }
    pub fn projected<R: 'static>(&self, projection: &Projection<R, Field>) -> ProjectedStep<R> {
        let operation = match &self.operation {
            Operation::Command(command) => {
                ProjectedOperation::Command(command.projected(projection))
            }
            Operation::Query(query) => ProjectedOperation::Query(query.projected(projection)),
        };
        ProjectedStep {
            source: self.clone(),
            projection: projection.clone(),
            operation,
        }
    }
    /// Context has already been bound to this occurrence's physical epoch and salt.
    pub fn run(
        &self,
        executor: &mut Executor<Field>,
        context: PhysicalContext,
    ) -> ExecutionResult<()> {
        let input = Rc::new(context);
        let result = match &self.operation {
            Operation::Query(query) => executor.query_with_context(query, input).map(|_| ()),
            Operation::Command(command) => executor.run_with_context(command, &context, input),
        };
        result.map_err(|cause| {
            ExecutionError::Failed(format!(
                "{} failed in epoch {}: {cause:?}",
                self.name,
                context.epoch_index + 1,
            ))
        })
    }
    fn run_nested(
        &self,
        scope: &mut CommandContext<'_, Field>,
        context: PhysicalContext,
    ) -> ExecutionResult<()> {
        let input = Rc::new(context);
        match &self.operation {
            Operation::Query(query) => scope.query_with_context(query, input).map(|_| ()),
            Operation::Command(command) => scope.run_with_context(command, &context, input),
        }
    }
}

/// These definitions are not a second runtime schedule.
pub struct NativeSteps(Vec<NativeStep>);

enum ProjectedOperation<R> {
    Command(Command<R, PhysicalContext>),
    Query(Query<R, ()>),
}
pub struct ProjectedStep<R> {
    source: NativeStep,
    projection: Projection<R, Field>,
    operation: ProjectedOperation<R>,
}
impl<R: 'static> ProjectedStep<R> {
    pub fn select(&self, executor: &mut Executor<R>, seed: i32) {
        self.source
            .select_in(&mut executor.selection_in(&self.projection), seed);
    }
    pub fn run(&self, executor: &mut Executor<R>, context: PhysicalContext) -> ExecutionResult<()> {
        let input = Rc::new(context);
        match &self.operation {
            ProjectedOperation::Command(command) => {
                executor.run_with_context(command, &context, input)
            }
            ProjectedOperation::Query(query) => {
                executor.query_with_context(query, input).map(|_| ())
            }
        }
    }
}
impl NativeSteps {
    pub fn get(&self, name: &str) -> ExecutionResult<&NativeStep> {
        self.0
            .iter()
            .find(|step| step.name == name)
            .ok_or_else(|| ExecutionError::Failed(format!("Unknown physical step: {name}")))
    }
    pub fn definitions(&self) -> &[NativeStep] {
        &self.0
    }
    /// Feature slots supply these references in their declared order. Plate motion itself has salt zero.
    pub fn deformation(steps: &[NativeStep]) -> Command<Field, PhysicalContext> {
        let steps = steps.to_vec();
        Command::with_inputs(
            "plate-deformation",
            CommandKind::Work,
            vec![],
            move |scope, interval: &PhysicalContext| {
                for step in &steps {
                    step.run_nested(
                        scope,
                        PhysicalContext {
                            seed: interval.seed ^ step.salt,
                            epoch_stable_seed: interval.epoch_stable_seed ^ step.salt,
                            ..*interval
                        },
                    )?;
                }
                Ok(())
            },
        )
    }
    pub fn select<'a>(
        &self,
        executor: &mut Executor<Field>,
        seed: i32,
        names: impl IntoIterator<Item = &'a str>,
    ) -> ExecutionResult<()> {
        for name in names {
            self.get(name)?.select(executor, seed);
        }
        Ok(())
    }
}
