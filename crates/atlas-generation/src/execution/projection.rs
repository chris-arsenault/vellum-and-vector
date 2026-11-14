//! Typed owner views keep nested operations on the enclosing map's live execution scope.
use super::*;

type OwnerRead<S> = dyn Fn(&dyn Any) -> ExecutionResult<&S>;
/// Provider registration over a typed view of the same enclosing owner.
pub struct Selection<'a, S> {
    scope: &'a Scope,
    read: Rc<OwnerRead<S>>,
}
impl<S: Any> Selection<'_, S> {
    fn strategy<T: QueryValue>(&self, body: Rc<QueryBody<S, T>>) -> Rc<SelectedQuery> {
        let read = self.read.clone();
        Rc::new(move |_, scope, root, invocation| {
            let state = read(root)?;
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
    pub fn select<T: QueryValue>(&mut self, query: &Query<S, T>) {
        self.scope
            .strategies
            .borrow_mut()
            .entry(query.id)
            .or_insert_with(|| self.strategy(query.read.clone()));
    }
    pub fn select_with_input<T: QueryValue, P: Any>(
        &mut self,
        query: &Query<S, T>,
        transform: impl Fn(&P) -> P + 'static,
    ) {
        let body = query.read.clone();
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
        self.scope
            .strategies
            .borrow_mut()
            .entry(query.id)
            .or_insert_with(|| self.strategy(read));
    }
}
impl<R: Any> Executor<R> {
    pub fn selection(&mut self) -> Selection<'_, R> {
        Selection {
            scope: &self.scope,
            read: Rc::new(|root| {
                root.downcast_ref::<R>().ok_or_else(|| {
                    ExecutionError::Failed("Provider requested a different map owner".into())
                })
            }),
        }
    }
    pub fn selection_in<S: Any>(&mut self, projection: &Projection<R, S>) -> Selection<'_, S> {
        let read = projection.read.clone();
        Selection {
            scope: &self.scope,
            read: Rc::new(move |root| {
                let owner = root.downcast_ref::<R>().ok_or_else(|| {
                    ExecutionError::Failed("Provider requested a different map owner".into())
                })?;
                Ok(read(owner))
            }),
        }
    }
}

pub(super) trait Access<S> {
    fn state(&self) -> &S;
    fn state_mut(&mut self) -> &mut S;
    fn root(&self) -> &dyn Any;
    fn root_mut(&mut self) -> &mut dyn Any;
}
pub(super) struct Root<'a, S>(pub(super) &'a mut S);
impl<S: Any> Access<S> for Root<'_, S> {
    fn state(&self) -> &S {
        self.0
    }
    fn state_mut(&mut self) -> &mut S {
        self.0
    }
    fn root(&self) -> &dyn Any {
        self.0
    }
    fn root_mut(&mut self) -> &mut dyn Any {
        self.0
    }
}
pub(super) struct Borrowed<'a, S>(pub(super) &'a mut dyn Access<S>);
impl<S> Access<S> for Borrowed<'_, S> {
    fn state(&self) -> &S {
        self.0.state()
    }
    fn state_mut(&mut self) -> &mut S {
        self.0.state_mut()
    }
    fn root(&self) -> &dyn Any {
        self.0.root()
    }
    fn root_mut(&mut self) -> &mut dyn Any {
        self.0.root_mut()
    }
}
type Read<R, S> = dyn Fn(&R) -> &S;
type Write<R, S> = dyn Fn(&mut R) -> &mut S;
pub struct Projection<R, S> {
    read: Rc<Read<R, S>>,
    write: Rc<Write<R, S>>,
}
impl<R, S> Clone for Projection<R, S> {
    fn clone(&self) -> Self {
        Self {
            read: self.read.clone(),
            write: self.write.clone(),
        }
    }
}
impl<R: Any, S: Any> Projection<R, S> {
    pub fn new(
        read: impl Fn(&R) -> &S + 'static,
        write: impl Fn(&mut R) -> &mut S + 'static,
    ) -> Self {
        Self {
            read: Rc::new(read),
            write: Rc::new(write),
        }
    }
}
impl<R: Any, S: Any> Projection<R, Executor<S>> {
    /// Existing field owners can join the map scope during caller migration. The inner
    /// executor is not dispatched, and none of its strategies or memos are used.
    pub fn state(self) -> Projection<R, S> {
        Projection::new(
            move |root| &(self.read)(root).state,
            move |root| &mut (self.write)(root).state,
        )
    }
}
struct Projected<'a, R, S> {
    parent: &'a mut dyn Access<R>,
    projection: Projection<R, S>,
}
impl<R, S> Access<S> for Projected<'_, R, S> {
    fn state(&self) -> &S {
        (self.projection.read)(self.parent.state())
    }
    fn state_mut(&mut self) -> &mut S {
        (self.projection.write)(self.parent.state_mut())
    }
    fn root(&self) -> &dyn Any {
        self.parent.root()
    }
    fn root_mut(&mut self) -> &mut dyn Any {
        self.parent.root_mut()
    }
}
impl<S: Any> QueryDependency<S> {
    fn projected<R: Any>(&self, projection: &Projection<R, S>) -> QueryDependency<R> {
        let dependency = self.clone();
        let read = projection.read.clone();
        QueryDependency {
            id: self.id,
            read: Rc::new(move |state, scope, root| (dependency.read)(read(state), scope, root)),
        }
    }
}
impl<S: Any, T: QueryValue> Query<S, T> {
    /// Projection preserves identity, selection, input binding and the query's dependencies.
    pub fn projected<R: Any>(&self, projection: &Projection<R, S>) -> Query<R, T> {
        let read = projection.read.clone();
        let body = self.read.clone();
        Query {
            id: self.id,
            name: self.name.clone(),
            dependencies: self
                .dependencies
                .iter()
                .map(|d| d.projected(projection))
                .collect(),
            read: Rc::new(move |state, context| {
                let state = read(state);
                body(
                    state,
                    &ReadContext {
                        state,
                        scope: context.scope,
                        root: context.root,
                        invocation: context.invocation,
                        input_override: context.input_override.clone(),
                    },
                )
            }),
        }
    }
}
impl<S: Any, P: 'static> Command<S, P> {
    /// Only a dispatched command receives the projected mutable owner view.
    pub fn projected<R: Any>(&self, projection: &Projection<R, S>) -> Command<R, P> {
        let projection = projection.clone();
        let dependencies = self
            .dependencies
            .iter()
            .map(|d| d.projected(&projection))
            .collect();
        let execute = match &self.execute {
            CommandBody::Sync(body) => {
                let body = body.clone();
                CommandBody::Sync(
                    Rc::new(move |context: &mut CommandContext<'_, R>, input: &P| {
                        let mut child = context.project(&projection);
                        body(&mut child, input)
                    }) as Rc<SyncCommandBody<R, P>>,
                )
            }
            CommandBody::Async(body) => {
                let body = body.clone();
                let execute: Rc<AsyncCommandBody<R, P>> = Rc::new(move |context, input| {
                    let body = body.clone();
                    let projection = projection.clone();
                    Box::pin(async move {
                        let mut child = context.project(&projection);
                        body(&mut child, input).await
                    })
                });
                CommandBody::Async(execute)
            }
        };
        Command {
            id: self.id,
            name: self.name.clone(),
            kind: self.kind,
            dependencies,
            execute,
        }
    }
}
impl<R: Any> CommandContext<'_, R> {
    /// A host-composed owner hook dispatches its command on the same live map scope.
    pub fn root_run<S: Any, P>(
        &mut self,
        command: &Command<S, P>,
        input: &P,
    ) -> ExecutionResult<()> {
        let state = self.access.root_mut().downcast_mut::<S>().ok_or_else(|| {
            ExecutionError::Failed("Command requested a different map owner".into())
        })?;
        let mut root = CommandContext {
            access: Box::new(Root(state)),
            scope: self.scope,
            values: self.values.clone(),
        };
        root.run(command, input)
    }
    pub fn project<S: Any>(&mut self, projection: &Projection<R, S>) -> CommandContext<'_, S> {
        CommandContext {
            access: Box::new(Projected {
                parent: self.access.as_mut(),
                projection: projection.clone(),
            }),
            scope: self.scope,
            values: self.values.clone(),
        }
    }
    pub fn root_query<S: Any, T: QueryValue>(&self, query: &Query<S, T>) -> ExecutionResult<Rc<T>> {
        let root = self.access.root();
        let state = root.downcast_ref::<S>().ok_or_else(|| {
            ExecutionError::Failed("Query requested a different map owner".into())
        })?;
        self.scope.query(state, query, root)
    }
}
