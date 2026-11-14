//! Opaque operations, synchronous queries and one map-owned invalidation scope.
mod input;
mod projection;
use crate::bindings::Invocation;
use projection::{Access, Borrowed, Root};
pub use projection::{Projection, Selection};
use std::{
    any::Any,
    cell::{Cell, RefCell},
    collections::HashMap,
    future::Future,
    pin::Pin,
    rc::Rc,
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT_OPERATION: AtomicUsize = AtomicUsize::new(0);
pub type ExecutionResult<T> = Result<T, ExecutionError>;
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExecutionError {
    Unselected(String),
    QueryCycle(String),
    MissingDependency,
    MissingInvocationInput(&'static str),
    Failed(String),
    AsyncDispatchRequired(String),
}
impl From<std::io::Error> for ExecutionError {
    fn from(error: std::io::Error) -> Self {
        Self::Failed(error.to_string())
    }
}

/// Explicit value contracts prevent a future from becoming a deferred query body.
/// Domain-owned value structs may implement this beside their definition.
/// ```compile_fail
/// use atlas_generation::execution::Query;
/// Query::<(),_>::new("deferred", vec![], |_,_| Ok(async { 3u32 }));
/// ```
pub trait QueryValue: Any {}
macro_rules! query_values {($($kind:ty),*)=>{$(impl QueryValue for $kind {})*};}
query_values!(
    (),
    bool,
    u8,
    i8,
    u32,
    i32,
    u64,
    i64,
    usize,
    isize,
    f32,
    f64,
    String
);
impl<T: QueryValue> QueryValue for Vec<T> {}
impl<T: QueryValue> QueryValue for Option<T> {}
impl<T: QueryValue, const N: usize> QueryValue for [T; N] {}
impl<A: QueryValue, B: QueryValue> QueryValue for (A, B) {}
impl<T: crate::storage::Sample> QueryValue for crate::storage::ReadBand<T> {}

type QueryBody<S, T> = dyn Fn(&S, &ReadContext<'_, S>) -> ExecutionResult<T>;
pub type CommandFuture<'a> = Pin<Box<dyn Future<Output = ExecutionResult<()>> + 'a>>;
type SyncCommandBody<S, P> = dyn Fn(&mut CommandContext<'_, S>, &P) -> ExecutionResult<()>;
type AsyncCommandBody<S, P> =
    dyn for<'a, 'scope> Fn(&'a mut CommandContext<'scope, S>, &'a P) -> CommandFuture<'a>;
enum CommandBody<S, P> {
    Sync(Rc<SyncCommandBody<S, P>>),
    Async(Rc<AsyncCommandBody<S, P>>),
}
type DependencyBody<S> = dyn Fn(&S, &Scope, &dyn Any) -> ExecutionResult<Option<Rc<dyn Any>>>;
type SelectedQuery = dyn Fn(&dyn Any, &Scope, &dyn Any, Invocation) -> ExecutionResult<Rc<dyn Any>>;

fn selected_query<S: Any, T: QueryValue>(body: Rc<QueryBody<S, T>>) -> Rc<SelectedQuery> {
    Rc::new(move |state, scope, root, invocation| {
        let state = state
            .downcast_ref::<S>()
            .or_else(|| root.downcast_ref::<S>())
            .ok_or_else(|| {
                ExecutionError::Failed("Query does not belong to this execution owner".into())
            })?;
        body(
            state,
            &ReadContext {
                state,
                scope,
                root,
                invocation,
                input_override: None,
            },
        )
        .map(|value| Rc::new(value) as Rc<dyn Any>)
    })
}

pub struct Query<S, T> {
    id: usize,
    name: String,
    dependencies: Vec<QueryDependency<S>>,
    read: Rc<QueryBody<S, T>>,
}
impl<S, T> Clone for Query<S, T> {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            name: self.name.clone(),
            dependencies: self.dependencies.clone(),
            read: self.read.clone(),
        }
    }
}
pub struct QueryDependency<S> {
    id: usize,
    read: Rc<DependencyBody<S>>,
}
impl<S> Clone for QueryDependency<S> {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            read: self.read.clone(),
        }
    }
}

/// References cannot be called or unpacked outside the dispatcher.
/// ```compile_fail
/// use atlas_generation::execution::Query;
/// let query = Query::<u32,u32>::new("sample", vec![], |state,_| Ok(*state));
/// query.read;
/// ```
impl<S: 'static, T: QueryValue> Query<S, T> {
    pub fn new(
        name: impl Into<String>,
        dependencies: Vec<QueryDependency<S>>,
        read: impl Fn(&S, &ReadContext<'_, S>) -> ExecutionResult<T> + 'static,
    ) -> Self {
        Self {
            id: NEXT_OPERATION.fetch_add(1, Ordering::Relaxed),
            name: name.into(),
            dependencies,
            read: Rc::new(read),
        }
    }
    pub fn identity(&self) -> usize {
        self.id
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn dependency(&self) -> QueryDependency<S> {
        let query = self.clone();
        QueryDependency {
            id: self.id,
            read: Rc::new(move |state, scope, root| {
                scope
                    .query(state, &query, root)
                    .map(|v| Some(v as Rc<dyn Any>))
            }),
        }
    }
    /// Unselected providers leave inherited state alone; no default strategy is installed.
    pub fn optional_dependency(&self) -> QueryDependency<S> {
        let query = self.clone();
        QueryDependency {
            id: self.id,
            read: Rc::new(move |state, scope, root| {
                scope
                    .optional(state, &query, root)
                    .map(|value| value.map(|v| v as Rc<dyn Any>))
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandKind {
    Initialize,
    Work,
    Elapsed,
    Event,
    Publish,
}
/// Command bodies remain behind dispatch just like query bodies.
/// ```compile_fail
/// use atlas_generation::execution::Command;
/// fn bypass(command:Command<u32>) {command.execute;}
/// ```
pub struct Command<S, P = ()> {
    id: usize,
    name: String,
    kind: CommandKind,
    dependencies: Vec<QueryDependency<S>>,
    execute: CommandBody<S, P>,
}
impl<S, P> Clone for Command<S, P> {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            name: self.name.clone(),
            kind: self.kind,
            dependencies: self.dependencies.clone(),
            execute: match &self.execute {
                CommandBody::Sync(body) => CommandBody::Sync(body.clone()),
                CommandBody::Async(body) => CommandBody::Async(body.clone()),
            },
        }
    }
}
impl<S: 'static> Command<S> {
    pub fn new(
        name: impl Into<String>,
        kind: CommandKind,
        dependencies: Vec<QueryDependency<S>>,
        execute: impl Fn(&mut S, &QueryValues) -> ExecutionResult<()> + 'static,
    ) -> Self {
        Self::with_inputs(name, kind, dependencies, move |context, _| {
            execute(context.access.state_mut(), &context.values)
        })
    }
    pub fn asynchronous(
        name: impl Into<String>,
        kind: CommandKind,
        dependencies: Vec<QueryDependency<S>>,
        execute: impl for<'a> Fn(&'a mut S, &'a QueryValues) -> CommandFuture<'a> + 'static,
    ) -> Self {
        Self::async_with_inputs(name, kind, dependencies, move |context, _| {
            execute(context.access.state_mut(), &context.values)
        })
    }
}
impl<S, P> Command<S, P> {
    /// Composition adds provider reads without wrapping or replacing the operation identity.
    pub fn depending_on(
        mut self,
        dependencies: impl IntoIterator<Item = QueryDependency<S>>,
    ) -> Self {
        self.dependencies.extend(dependencies);
        self
    }
    pub fn with_inputs(
        name: impl Into<String>,
        kind: CommandKind,
        dependencies: Vec<QueryDependency<S>>,
        execute: impl Fn(&mut CommandContext<'_, S>, &P) -> ExecutionResult<()> + 'static,
    ) -> Self {
        Self {
            id: NEXT_OPERATION.fetch_add(1, Ordering::Relaxed),
            name: name.into(),
            kind,
            dependencies,
            execute: CommandBody::Sync(Rc::new(execute)),
        }
    }
    pub fn async_with_inputs(
        name: impl Into<String>,
        kind: CommandKind,
        dependencies: Vec<QueryDependency<S>>,
        execute: impl for<'a, 'scope> Fn(&'a mut CommandContext<'scope, S>, &'a P) -> CommandFuture<'a>
            + 'static,
    ) -> Self {
        Self {
            id: NEXT_OPERATION.fetch_add(1, Ordering::Relaxed),
            name: name.into(),
            kind,
            dependencies,
            execute: CommandBody::Async(Rc::new(execute)),
        }
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn kind(&self) -> CommandKind {
        self.kind
    }
    pub fn identity(&self) -> usize {
        self.id
    }
}
impl<S: 'static, P: 'static> Command<S, P> {
    /// A step binds its inputs without creating another operation or registration identity.
    pub(crate) fn bind_input(&self, input: P) -> Command<S> {
        let execute = match &self.execute {
            CommandBody::Sync(body) => {
                let body = body.clone();
                CommandBody::Sync(Rc::new(move |context: &mut CommandContext<'_, S>, _: &()| {
                    body(context, &input)
                }) as Rc<SyncCommandBody<S, ()>>)
            }
            CommandBody::Async(body) => {
                let body = body.clone();
                let input = Rc::new(input);
                let bound: Rc<AsyncCommandBody<S, ()>> = Rc::new(move |context, _| {
                    let body = body.clone();
                    let input = input.clone();
                    Box::pin(async move { body(context, &input).await })
                });
                CommandBody::Async(bound)
            }
        };
        Command {
            id: self.id,
            name: self.name.clone(),
            kind: self.kind,
            dependencies: self.dependencies.clone(),
            execute,
        }
    }
}

/// Captured dependency values for a command, before its writes begin.
#[derive(Clone, Default)]
pub struct QueryValues {
    values: HashMap<usize, Rc<dyn Any>>,
    invocation: Invocation,
    input: Option<Rc<dyn Any>>,
}
impl QueryValues {
    pub fn input<P: Any>(&self) -> ExecutionResult<Rc<P>> {
        input::get(self.input.clone())
    }
    pub fn invocation(&self) -> Invocation {
        self.invocation
    }
    pub fn optional<S, T: 'static>(&self, query: &Query<S, T>) -> ExecutionResult<Option<Rc<T>>> {
        self.values
            .get(&query.id)
            .cloned()
            .map(|v| v.downcast().map_err(|_| ExecutionError::MissingDependency))
            .transpose()
    }
    pub fn get<S, T: 'static>(&self, query: &Query<S, T>) -> ExecutionResult<Rc<T>> {
        self.optional(query)?
            .ok_or(ExecutionError::MissingDependency)
    }
}

/// Queries compose through the same read dispatcher, including from ordinary local helpers.
/// They cannot obtain a command capability or a mutable domain state.
/// ```compile_fail
/// use atlas_generation::execution::{Command,CommandKind,Query};
/// let command=Command::new("write",CommandKind::Work,vec![],|state:&mut u32,_|{*state+=1;Ok(())});
/// Query::<u32,()>::new("bad query",vec![],move |_,reader|reader.run(&command));
/// ```
pub struct ReadContext<'a, S> {
    state: &'a S,
    scope: &'a Scope,
    root: &'a dyn Any,
    invocation: Invocation,
    input_override: Option<Rc<dyn Any>>,
}
impl<S: 'static> ReadContext<'_, S> {
    pub fn input<P: Any>(&self) -> ExecutionResult<Rc<P>> {
        input::get(
            self.input_override
                .clone()
                .or_else(|| self.scope.inputs.current()),
        )
    }
    pub fn invocation(&self) -> Invocation {
        self.invocation
    }
    pub fn get<T: QueryValue>(&self, query: &Query<S, T>) -> ExecutionResult<Rc<T>> {
        self.scope.query(self.state, query, self.root)
    }
    pub fn optional<T: QueryValue>(&self, query: &Query<S, T>) -> ExecutionResult<Option<Rc<T>>> {
        self.scope.optional(self.state, query, self.root)
    }
    pub fn resolve(&self, dependency: &QueryDependency<S>) -> ExecutionResult<()> {
        (dependency.read)(self.state, self.scope, self.root).map(|_| ())
    }
    /// A field dependency may read a map-owned query through the same scope.
    pub fn root_query<R: Any, T: QueryValue>(&self, query: &Query<R, T>) -> ExecutionResult<Rc<T>> {
        let state = self.root.downcast_ref::<R>().ok_or_else(|| {
            ExecutionError::Failed("Query requested a different map owner".into())
        })?;
        self.scope.query(state, query, self.root)
    }
}

struct Memo {
    revision: u64,
    input_revision: u64,
    value: Rc<dyn Any>,
}
#[derive(Default)]
struct Revision {
    number: Cell<u64>,
    batch: Cell<usize>,
    changed: Cell<bool>,
}
impl Revision {
    fn invalidate(&self) {
        if self.batch.get() > 0 {
            self.changed.set(true);
        } else {
            self.number.set(self.number.get().wrapping_add(1));
        }
    }
}
struct Mutation(Rc<Revision>);
impl Drop for Mutation {
    fn drop(&mut self) {
        self.0.invalidate();
    }
}
struct Batch(Rc<Revision>);
impl Drop for Batch {
    fn drop(&mut self) {
        self.0.batch.set(self.0.batch.get() - 1);
        if self.0.batch.get() == 0 && self.0.changed.replace(false) {
            self.0.invalidate();
        }
    }
}
struct Scope {
    revision: Rc<Revision>,
    strategies: RefCell<HashMap<usize, Rc<SelectedQuery>>>,
    memos: RefCell<HashMap<usize, Memo>>,
    reading: RefCell<Vec<usize>>,
    invocation: Cell<Invocation>,
    inputs: Rc<input::Inputs>,
    salts: RefCell<HashMap<usize, i32>>,
}
impl Scope {
    fn optional<S: Any, T: QueryValue>(
        &self,
        state: &S,
        query: &Query<S, T>,
        root: &dyn Any,
    ) -> ExecutionResult<Option<Rc<T>>> {
        if !self.strategies.borrow().contains_key(&query.id) {
            return Ok(None);
        }
        self.query(state, query, root).map(Some)
    }
    fn dependencies<S: Any>(
        &self,
        state: &S,
        dependencies: &[QueryDependency<S>],
        root: &dyn Any,
    ) -> ExecutionResult<QueryValues> {
        let mut values = QueryValues {
            invocation: self.invocation.get(),
            input: self.inputs.current(),
            ..QueryValues::default()
        };
        for dependency in dependencies {
            if let Some(value) = (dependency.read)(state, self, root)? {
                values.values.insert(dependency.id, value);
            }
        }
        Ok(values)
    }
    fn query<S: Any, T: QueryValue>(
        &self,
        state: &S,
        query: &Query<S, T>,
        root: &dyn Any,
    ) -> ExecutionResult<Rc<T>> {
        let revision = self.revision.number.get();
        if let Some(memo) = self.memos.borrow().get(&query.id).filter(|memo| {
            memo.revision == revision && memo.input_revision == self.inputs.revision()
        }) {
            return memo
                .value
                .clone()
                .downcast()
                .map_err(|_| ExecutionError::MissingDependency);
        }
        let body = self
            .strategies
            .borrow()
            .get(&query.id)
            .cloned()
            .ok_or_else(|| ExecutionError::Unselected(query.name.clone()))?;
        if self.reading.borrow().contains(&query.id) {
            return Err(ExecutionError::QueryCycle(query.name.clone()));
        }
        self.reading.borrow_mut().push(query.id);
        let mut invocation = self.invocation.get();
        if let Some(salt) = self.salts.borrow().get(&query.id) {
            invocation.step_salt = *salt;
        }
        // Derived queries describe current state; they do not apply work exposure.
        invocation.exposure = 0.0;
        let result = self
            .dependencies(state, &query.dependencies, root)
            .and_then(|_| body(state, self, root, invocation));
        self.reading.borrow_mut().pop();
        let value = result?;
        self.memos.borrow_mut().insert(
            query.id,
            Memo {
                revision,
                input_revision: self.inputs.revision(),
                value: value.clone(),
            },
        );
        value
            .downcast()
            .map_err(|_| ExecutionError::MissingDependency)
    }
}

/// Queries receive &S; commands alone receive &mut S. Derived caches live outside S.
/// ```compile_fail
/// use atlas_generation::execution::Query;
/// Query::<Vec<u32>,()>::new("bad query", vec![], |state,_| {state.push(7);Ok(())});
/// ```
// owner-direction(2026-11-12): software architecture paradigms should not change during the Rust port
pub struct Executor<S> {
    state: S,
    scope: Scope,
}
impl<S: 'static> Executor<S> {
    pub fn new(state: S) -> Self {
        Self {
            state,
            scope: Scope {
                revision: Rc::default(),
                strategies: RefCell::default(),
                memos: RefCell::default(),
                reading: RefCell::default(),
                invocation: Cell::default(),
                inputs: Rc::default(),
                salts: RefCell::default(),
            },
        }
    }
    pub fn state(&self) -> &S {
        &self.state
    }
    pub fn revision(&self) -> u64 {
        self.scope.revision.number.get()
    }
    pub fn set_invocation(&mut self, invocation: Invocation) {
        if self.scope.invocation.replace(invocation) != invocation {
            self.scope.memos.borrow_mut().clear();
        }
    }
    pub fn invocation(&self) -> Invocation {
        self.scope.invocation.get()
    }
    pub fn select_with_salt<T: QueryValue>(&mut self, query: &Query<S, T>, salt: i32) {
        self.select(query);
        if self.scope.salts.borrow_mut().insert(query.id, salt) != Some(salt) {
            self.scope.memos.borrow_mut().clear();
        }
    }
    pub fn select<T: QueryValue>(&mut self, query: &Query<S, T>) {
        self.scope
            .strategies
            .borrow_mut()
            .entry(query.id)
            .or_insert_with(|| selected_query(query.read.clone()));
    }
    /// A selected provider owns its input interpretation. Dependencies still receive the
    /// caller's context, and an already-bound regional strategy remains authoritative.
    pub fn select_with_input<T: QueryValue, P: Any>(
        &mut self,
        query: &Query<S, T>,
        transform: impl Fn(&P) -> P + 'static,
    ) {
        let body = query.read.clone();
        self.scope
            .strategies
            .borrow_mut()
            .entry(query.id)
            .or_insert_with(|| {
                let read: Rc<QueryBody<S, T>> = Rc::new(move |state, reader| {
                    let input = reader.input::<P>()?;
                    body(
                        state,
                        &ReadContext {
                            state,
                            scope: reader.scope,
                            root: reader.root,
                            invocation: reader.invocation,
                            input_override: Some(Rc::new(transform(&input))),
                        },
                    )
                });
                selected_query(read)
            });
    }
    pub fn bind<T: QueryValue>(
        &mut self,
        query: &Query<S, T>,
        read: impl Fn(&S, &ReadContext<'_, S>) -> ExecutionResult<T> + 'static,
    ) {
        let body: Rc<QueryBody<S, T>> = Rc::new(read);
        self.scope
            .strategies
            .borrow_mut()
            .insert(query.id, selected_query(body));
        self.scope.memos.borrow_mut().clear();
    }
    pub fn query<T: QueryValue>(&self, query: &Query<S, T>) -> ExecutionResult<Rc<T>> {
        self.scope.query(&self.state, query, &self.state)
    }
    /// Specialize a read around its original algorithm without dispatching it recursively.
    pub fn bind_before<T: QueryValue>(
        &mut self,
        query: &Query<S, T>,
        before: impl Fn(&S) -> ExecutionResult<()> + 'static,
    ) {
        let read = query.read.clone();
        self.bind(query, move |state, context| {
            before(state)?;
            read(state, context)
        });
    }
    pub fn bind_after<T: QueryValue>(
        &mut self,
        query: &Query<S, T>,
        after: impl Fn(&S) -> ExecutionResult<()> + 'static,
    ) {
        let read = query.read.clone();
        self.bind(query, move |state, context| {
            let result = read(state, context)?;
            after(state)?;
            Ok(result)
        });
    }
    pub fn query_with_context<T: QueryValue, I: Any>(
        &self,
        query: &Query<S, T>,
        input: Rc<I>,
    ) -> ExecutionResult<Rc<T>> {
        let _input = self.scope.inputs.bind(input);
        self.query(query)
    }
    /// Ordinary workflow helpers share one invocation input across their dispatched operations.
    pub fn with_context<I: Any, T>(
        &mut self,
        input: Rc<I>,
        run: impl FnOnce(&mut Self) -> ExecutionResult<T>,
    ) -> ExecutionResult<T> {
        let _input = self.scope.inputs.bind(input);
        run(self)
    }
    pub fn run_with_context<P, I: Any>(
        &mut self,
        command: &Command<S, P>,
        argument: &P,
        input: Rc<I>,
    ) -> ExecutionResult<()> {
        let _input = self.scope.inputs.bind(input);
        self.run_with(command, argument)
    }
    pub async fn run_async_with_context<P, I: Any>(
        &mut self,
        command: &Command<S, P>,
        argument: &P,
        input: Rc<I>,
    ) -> ExecutionResult<()> {
        let _input = self.scope.inputs.bind(input);
        self.run_async_with(command, argument).await
    }
    pub fn run(&mut self, command: &Command<S>) -> ExecutionResult<()> {
        self.run_with_salt(command, self.scope.invocation.get().step_salt)
    }
    pub fn run_with_salt(&mut self, command: &Command<S>, salt: i32) -> ExecutionResult<()> {
        let mut invocation = self.scope.invocation.get();
        invocation.step_salt = salt;
        self.command_context(invocation).run(command, &())
    }
    pub fn run_with<P>(&mut self, command: &Command<S, P>, input: &P) -> ExecutionResult<()> {
        let invocation = self.scope.invocation.get();
        self.command_context(invocation).run(command, input)
    }
    fn command_context(&mut self, invocation: Invocation) -> CommandContext<'_, S> {
        CommandContext {
            access: Box::new(Root(&mut self.state)),
            scope: &self.scope,
            values: QueryValues {
                invocation,
                input: self.scope.inputs.current(),
                ..QueryValues::default()
            },
        }
    }
    /// Mutation invalidation survives success, failure and dropping a suspended invocation.
    pub async fn run_async(&mut self, command: &Command<S>) -> ExecutionResult<()> {
        self.run_async_with_salt(command, self.scope.invocation.get().step_salt)
            .await
    }
    pub async fn run_async_with_salt(
        &mut self,
        command: &Command<S>,
        salt: i32,
    ) -> ExecutionResult<()> {
        let mut invocation = self.scope.invocation.get();
        invocation.step_salt = salt;
        self.command_context(invocation)
            .run_async(command, &())
            .await
    }
    pub async fn run_async_with<P>(
        &mut self,
        command: &Command<S, P>,
        input: &P,
    ) -> ExecutionResult<()> {
        let invocation = self.scope.invocation.get();
        self.command_context(invocation)
            .run_async(command, input)
            .await
    }
    pub fn batch<T>(
        &mut self,
        settle: impl FnOnce(&mut Self) -> ExecutionResult<T>,
    ) -> ExecutionResult<T> {
        self.scope
            .revision
            .batch
            .set(self.scope.revision.batch.get() + 1);
        let _batch = Batch(self.scope.revision.clone());
        settle(self)
    }
}

/// Only dispatched commands obtain this capability. Nested operations use the same owner scope.
/// ```compile_fail
/// use atlas_generation::execution::{Command, CommandKind, Query};
/// let write = Command::<u32,u32>::with_inputs("write", CommandKind::Work, vec![], |context, amount| { *context.state_mut() += amount; Ok(()) });
/// Query::<u32,()>::new("bad query", vec![], move |_, reader| reader.run(&write, &1));
/// ```
pub struct CommandContext<'scope, S> {
    access: Box<dyn Access<S> + 'scope>,
    scope: &'scope Scope,
    values: QueryValues,
}
impl<S: 'static> CommandContext<'_, S> {
    pub fn with_context<I: Any, T>(&mut self, input: Rc<I>, run: impl FnOnce(&mut Self) -> T) -> T {
        let _input = self.scope.inputs.bind(input);
        run(self)
    }
    pub fn state(&self) -> &S {
        self.access.state()
    }
    pub fn state_mut(&mut self) -> &mut S {
        self.access.state_mut()
    }
    pub fn values(&self) -> &QueryValues {
        &self.values
    }
    /// Disjoint borrows of the command's writer and its already evaluated inputs.
    pub fn parts(&mut self) -> (&mut S, &QueryValues) {
        (self.access.state_mut(), &self.values)
    }
    pub fn query<T: QueryValue>(&self, query: &Query<S, T>) -> ExecutionResult<Rc<T>> {
        self.scope.query(self.state(), query, self.access.root())
    }
    pub fn query_with_context<T: QueryValue, I: Any>(
        &self,
        query: &Query<S, T>,
        input: Rc<I>,
    ) -> ExecutionResult<Rc<T>> {
        let _input = self.scope.inputs.bind(input);
        self.query(query)
    }
    pub fn run_with_context<P, I: Any>(
        &mut self,
        command: &Command<S, P>,
        argument: &P,
        input: Rc<I>,
    ) -> ExecutionResult<()> {
        let _input = self.scope.inputs.bind(input);
        self.run(command, argument)
    }
    pub async fn run_async_with_context<P, I: Any>(
        &mut self,
        command: &Command<S, P>,
        argument: &P,
        input: Rc<I>,
    ) -> ExecutionResult<()> {
        let _input = self.scope.inputs.bind(input);
        self.run_async(command, argument).await
    }
    fn nested<P>(&mut self, command: &Command<S, P>) -> ExecutionResult<CommandContext<'_, S>> {
        let mut values =
            self.scope
                .dependencies(self.state(), &command.dependencies, self.access.root())?;
        values.invocation = self.values.invocation;
        Ok(CommandContext {
            access: Box::new(Borrowed(self.access.as_mut())),
            scope: self.scope,
            values,
        })
    }
    pub fn run<P>(&mut self, command: &Command<S, P>, input: &P) -> ExecutionResult<()> {
        let CommandBody::Sync(execute) = &command.execute else {
            return Err(ExecutionError::AsyncDispatchRequired(command.name.clone()));
        };
        let mut context = self.nested(command)?;
        let _mutation = Mutation(context.scope.revision.clone());
        execute(&mut context, input)
    }
    pub async fn run_async<P>(
        &mut self,
        command: &Command<S, P>,
        input: &P,
    ) -> ExecutionResult<()> {
        let mut context = self.nested(command)?;
        let _mutation = Mutation(context.scope.revision.clone());
        match &command.execute {
            CommandBody::Sync(execute) => execute(&mut context, input),
            CommandBody::Async(execute) => execute(&mut context, input).await,
        }
    }
    pub fn batch<T>(
        &mut self,
        settle: impl FnOnce(&mut Self) -> ExecutionResult<T>,
    ) -> ExecutionResult<T> {
        self.scope
            .revision
            .batch
            .set(self.scope.revision.batch.get() + 1);
        let _batch = Batch(self.scope.revision.clone());
        settle(self)
    }
}
