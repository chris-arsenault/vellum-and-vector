//! Feature-owned executable steps supply both selected execution and registration.
use crate::execution::{Command, ExecutionResult, Executor, Query, QueryValue};
use std::{collections::BTreeMap, rc::Rc};

type Invoke<S> = dyn Fn(&mut Executor<S>) -> ExecutionResult<()>;
type Select<S> = dyn Fn(&mut Executor<S>);
enum StepOperation<S> {
    Command(Rc<Command<S>>),
    Query {
        invoke: Rc<Invoke<S>>,
        select: Rc<Select<S>>,
    },
}
impl<S> Clone for StepOperation<S> {
    fn clone(&self) -> Self {
        match self {
            Self::Command(command) => Self::Command(command.clone()),
            Self::Query { invoke, select } => Self::Query {
                invoke: invoke.clone(),
                select: select.clone(),
            },
        }
    }
}
/// An executable reference, never a raw process callback exposed to the caller.
pub struct Step<S> {
    pub name: String,
    pub seed_salt: i32,
    operation: usize,
    operation_name: String,
    invoke: StepOperation<S>,
}
impl<S> Clone for Step<S> {
    fn clone(&self) -> Self {
        Self {
            name: self.name.clone(),
            seed_salt: self.seed_salt,
            operation: self.operation,
            operation_name: self.operation_name.clone(),
            invoke: self.invoke.clone(),
        }
    }
}
impl<S: 'static> Step<S> {
    pub fn command_with<P: 'static>(
        name: impl Into<String>,
        seed_salt: i32,
        command: &Command<S, P>,
        input: P,
    ) -> Self {
        Self::command(name, seed_salt, Rc::new(command.bind_input(input)))
    }
    pub fn command(name: impl Into<String>, seed_salt: i32, command: Rc<Command<S>>) -> Self {
        Self {
            name: name.into(),
            seed_salt,
            operation: command.identity(),
            operation_name: command.name().into(),
            invoke: StepOperation::Command(command),
        }
    }
    pub fn query<T: QueryValue>(
        name: impl Into<String>,
        seed_salt: i32,
        query: Query<S, T>,
    ) -> Self {
        let selection = query.clone();
        Self {
            name: name.into(),
            seed_salt,
            operation: query.identity(),
            operation_name: query.name().into(),
            invoke: StepOperation::Query {
                invoke: Rc::new(move |executor| executor.query(&query).map(|_| ())),
                select: Rc::new(move |executor| executor.select_with_salt(&selection, seed_salt)),
            },
        }
    }
    fn run(&self, executor: &mut Executor<S>) -> ExecutionResult<()> {
        match &self.invoke {
            StepOperation::Command(command) => executor.run_with_salt(command, self.seed_salt),
            StepOperation::Query { invoke, .. } => invoke(executor),
        }
    }
    async fn run_async(&self, executor: &mut Executor<S>) -> ExecutionResult<()> {
        match &self.invoke {
            StepOperation::Command(command) => {
                executor.run_async_with_salt(command, self.seed_salt).await
            }
            StepOperation::Query { invoke, .. } => invoke(executor),
        }
    }
}
pub struct Feature<S> {
    pub id: String,
    pub steps: Vec<Step<S>>,
}

/// There is no independently supplied native registry or scheduler.
pub struct CompiledSequence<S> {
    steps: Vec<Step<S>>,
    features: Vec<String>,
    operations: BTreeMap<String, usize>,
}
impl<S: 'static> CompiledSequence<S> {
    pub fn from_features(
        features: impl IntoIterator<Item = Feature<S>>,
    ) -> Result<Self, &'static str> {
        let mut steps = Vec::new();
        let mut owners = Vec::new();
        for feature in features {
            for step in feature.steps {
                steps.push(step);
                owners.push(feature.id.clone());
            }
        }
        let mut operations = BTreeMap::new();
        for step in &steps {
            if let Some(existing) = operations.insert(step.operation_name.clone(), step.operation) {
                if existing != step.operation {
                    return Err("An operation name cannot identify two implementations");
                }
            }
        }
        Ok(Self {
            steps,
            features: owners,
            operations,
        })
    }
    pub fn steps(&self) -> &[Step<S>] {
        &self.steps
    }
    pub fn registered(&self) -> impl Iterator<Item = &str> {
        self.operations.keys().map(String::as_str)
    }
    pub fn feature_at(&self, step: usize) -> Option<&str> {
        self.features.get(step).map(String::as_str)
    }
    pub fn execute(&self, executor: &mut Executor<S>) -> ExecutionResult<()> {
        self.bind_queries(executor);
        for step in &self.steps {
            step.run(executor)?;
        }
        Ok(())
    }
    pub async fn execute_async(&self, executor: &mut Executor<S>) -> ExecutionResult<()> {
        self.bind_queries(executor);
        for step in &self.steps {
            step.run_async(executor).await?;
        }
        Ok(())
    }
    pub fn bind_queries(&self, executor: &mut Executor<S>) {
        for step in &self.steps {
            if let StepOperation::Query { select, .. } = &step.invoke {
                select(executor);
            }
        }
    }
}
