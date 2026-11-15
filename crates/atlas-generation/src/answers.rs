//! Named coupled questions with lazy dependencies and packed point workspaces.
use crate::{
    execution::{
        ExecutionError, ExecutionResult, Query, QueryDependency, QueryValue, QueryValues,
        ReadContext,
    },
    hpc::EpochStamps,
    storage::{Band, Coverage, ReadBand},
};
use std::{
    cell::{OnceCell, RefCell},
    collections::BTreeMap,
    rc::Rc,
};

pub type Response<S, K> = dyn for<'a> Fn(&S, usize, &mut Answers<'a, S, K>) -> ExecutionResult<f64>;
// Arconis: docs/architecture/subsystems.arconis#item=q_kinds — the four ways a responder shapes an answer.
pub enum ResponseKind<S, K> {
    Base(Box<Response<S, K>>),
    Add(Box<Response<S, K>>),
    Scale(Box<Response<S, K>>),
    Break {
        share: Box<Response<S, K>>,
        instead: Box<Response<S, K>>,
    },
}
pub struct Responder<S, K> {
    pub by: String,
    pub kind: ResponseKind<S, K>,
    pub queries: Vec<QueryDependency<S>>,
}
// Arconis: docs/architecture/subsystems.arconis#item=q_book — keeps each question's responders, one base per question.
pub struct QuestionBook<S, K> {
    indices: BTreeMap<K, usize>,
    responders: Vec<Vec<Responder<S, K>>>,
}
/// Operations and their responders refer to one another during registration. A run binds
/// the complete book once, before dispatch; weak query links avoid an ownership cycle.
pub struct QuestionBinding<S, K> {
    book: Rc<OnceCell<QuestionBook<S, K>>>,
}
impl<S, K> Default for QuestionBinding<S, K> {
    fn default() -> Self {
        Self {
            book: Rc::new(OnceCell::new()),
        }
    }
}
impl<S: 'static, K: Copy + Ord + 'static> QuestionBinding<S, K> {
    pub fn bind(&self, book: QuestionBook<S, K>) -> ExecutionResult<()> {
        self.book
            .set(book)
            .map_err(|_| ExecutionError::Failed("Question responders are already bound".into()))
    }
    pub fn book(&self) -> ExecutionResult<&QuestionBook<S, K>> {
        self.book.get().ok_or_else(|| {
            ExecutionError::Failed("Bind complete question responders before execution".into())
        })
    }
    pub fn query_in(
        &self,
        name: impl Into<String>,
        key: K,
        coverage: fn(&S) -> &RefCell<Coverage>,
    ) -> Query<S, AnswerBand> {
        let binding = Rc::downgrade(&self.book);
        Query::new(name, vec![], move |state, reader| {
            let binding = binding
                .upgrade()
                .ok_or_else(|| ExecutionError::Failed("Question binding was released".into()))?;
            let book = binding.get().ok_or_else(|| {
                ExecutionError::Failed("Bind complete question responders before execution".into())
            })?;
            let mut band = coverage(state).borrow_mut().allocate(0.0f64);
            book.fill_band(state, key, &mut band, AnswerQueries::Current(reader))?;
            Ok(AnswerBand { band })
        })
    }
}
impl<S, K> Default for QuestionBook<S, K> {
    fn default() -> Self {
        Self {
            indices: BTreeMap::new(),
            responders: Vec::new(),
        }
    }
}
impl<S: 'static, K: Copy + Ord> QuestionBook<S, K> {
    pub fn respond(&mut self, key: K, responder: Responder<S, K>) -> ExecutionResult<()> {
        let index = if let Some(&index) = self.indices.get(&key) {
            index
        } else {
            let index = self.responders.len();
            self.indices.insert(key, index);
            self.responders.push(Vec::new());
            index
        };
        if matches!(responder.kind, ResponseKind::Base(_))
            && self.responders[index]
                .iter()
                .any(|one| matches!(one.kind, ResponseKind::Base(_)))
        {
            return Err(ExecutionError::Failed(
                "A question has one base answer".into(),
            ));
        }
        self.responders[index].push(responder);
        Ok(())
    }
    /// Inspection evaluates current observations without refreshing queries or cached fields.
    pub fn point(
        &self,
        state: &S,
        key: K,
        cell: usize,
        queries: &QueryValues,
    ) -> ExecutionResult<f64> {
        let mut workspace = Workspace::new(self.responders.len());
        Answers {
            book: self,
            state,
            cell,
            queries: AnswerQueries::Captured(queries),
            workspace: &mut workspace,
        }
        .ask(key)
    }
    pub fn band(
        &self,
        state: &S,
        key: K,
        coverage: &mut Coverage,
        queries: &QueryValues,
    ) -> ExecutionResult<AnswerBand> {
        let mut band = coverage.allocate(0.0f64);
        self.fill_band(state, key, &mut band, AnswerQueries::Captured(queries))?;
        Ok(AnswerBand { band })
    }
    /// One reusable workspace per band, never per-cell maps or boxed records.
    fn fill_band(
        &self,
        state: &S,
        key: K,
        band: &mut Band<f64>,
        queries: AnswerQueries<'_, S>,
    ) -> ExecutionResult<()> {
        let mut workspace = Workspace::new(self.responders.len());
        for block in 0..band.len().div_ceil(crate::lattice::BLOCK_CELLS) {
            let mut values = band
                .write_block(block)
                .map_err(|e| ExecutionError::Failed(e.to_string()))?;
            for (offset, value) in values.iter_mut().enumerate() {
                workspace.begin();
                *value = Answers {
                    book: self,
                    state,
                    cell: block * crate::lattice::BLOCK_CELLS + offset,
                    queries,
                    workspace: &mut workspace,
                }
                .ask(key)?;
            }
        }
        Ok(())
    }
}
impl<S: 'static, K: Copy + Ord + 'static> QuestionBook<S, K> {
    /// Bind to the run's own coverage, rather than constructing a parallel answer workspace.
    pub fn query_in(
        self: Rc<Self>,
        name: impl Into<String>,
        key: K,
        coverage: fn(&S) -> &RefCell<Coverage>,
    ) -> Query<S, AnswerBand> {
        Query::new(name, vec![], move |state, reader| {
            let mut band = coverage(state).borrow_mut().allocate(0.0f64);
            self.fill_band(state, key, &mut band, AnswerQueries::Current(reader))?;
            Ok(AnswerBand { band })
        })
    }
    pub fn query(
        self: Rc<Self>,
        name: impl Into<String>,
        key: K,
        coverage: Rc<RefCell<Coverage>>,
    ) -> Query<S, AnswerBand> {
        Query::new(name, vec![], move |state, reader| {
            // End the allocation borrow before providers can allocate their own derived outputs.
            let mut band = coverage.borrow_mut().allocate(0.0f64);
            self.fill_band(state, key, &mut band, AnswerQueries::Current(reader))?;
            Ok(AnswerBand { band })
        })
    }
}

pub struct AnswerBand {
    band: Band<f64>,
}
impl AnswerBand {
    pub fn values(&self) -> ReadBand<f64> {
        self.band.read_only()
    }
}
impl QueryValue for AnswerBand {}

pub enum AnswerQueries<'a, S> {
    Captured(&'a QueryValues),
    Current(&'a ReadContext<'a, S>),
}
impl<S> Copy for AnswerQueries<'_, S> {}
impl<S> Clone for AnswerQueries<'_, S> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<S: 'static> AnswerQueries<'_, S> {
    pub fn input<P: std::any::Any>(&self) -> ExecutionResult<Rc<P>> {
        match self {
            Self::Captured(values) => values.input(),
            Self::Current(reader) => reader.input(),
        }
    }
    pub fn get<T: QueryValue>(&self, query: &Query<S, T>) -> ExecutionResult<Rc<T>> {
        match self {
            Self::Captured(values) => values.get(query),
            Self::Current(reader) => reader.get(query),
        }
    }
    pub fn optional<T: QueryValue>(&self, query: &Query<S, T>) -> ExecutionResult<Option<Rc<T>>> {
        match self {
            Self::Captured(values) => values.optional(query),
            Self::Current(reader) => reader.optional(query),
        }
    }
    fn resolve(&self, dependency: &QueryDependency<S>) -> ExecutionResult<()> {
        match self {
            Self::Captured(_) => Ok(()),
            Self::Current(reader) => reader.resolve(dependency),
        }
    }
}
struct Workspace {
    memo: EpochStamps<f64>,
    reading: EpochStamps<()>,
    resolved: EpochStamps<()>,
}
impl Workspace {
    fn new(length: usize) -> Self {
        Self {
            memo: EpochStamps::new(length),
            reading: EpochStamps::new(length),
            resolved: EpochStamps::new(length),
        }
    }
    fn begin(&mut self) {
        self.memo.begin();
        self.reading.begin();
    }
}
pub struct Answers<'a, S, K> {
    book: &'a QuestionBook<S, K>,
    state: &'a S,
    cell: usize,
    queries: AnswerQueries<'a, S>,
    workspace: &'a mut Workspace,
}
impl<S: 'static, K: Copy + Ord> Answers<'_, S, K> {
    pub fn queries(&self) -> AnswerQueries<'_, S> {
        self.queries
    }
    pub fn ask(&mut self, key: K) -> ExecutionResult<f64> {
        let &index = self
            .book
            .indices
            .get(&key)
            .ok_or_else(|| ExecutionError::Failed("Nothing answers the question".into()))?;
        if let Some(value) = self.workspace.memo.get(index) {
            return Ok(*value);
        }
        if !self.workspace.reading.mark(index) {
            return Err(ExecutionError::QueryCycle("Coupled answer".into()));
        }
        let result = self.compose(index);
        self.workspace.reading.forget(index);
        let value = result?;
        self.workspace.memo.set(index, value);
        Ok(value)
    }
    // Arconis: docs/architecture/subsystems.arconis#item=q_compose — combines base, adds, scales and breaks into one answer.
    fn compose(&mut self, index: usize) -> ExecutionResult<f64> {
        self.resolve(index)?;
        let book = self.book;
        let state = self.state;
        let cell = self.cell;
        let all = &book.responders[index];
        let base = all
            .iter()
            .find_map(|r| match &r.kind {
                ResponseKind::Base(read) => Some(read),
                _ => None,
            })
            .ok_or_else(|| ExecutionError::Failed("Nothing supplies the base answer".into()))?;
        let mut value = base(state, cell, self)?;
        for responder in all {
            if let ResponseKind::Add(read) = &responder.kind {
                value += read(state, cell, self)?;
            }
        }
        for responder in all {
            if let ResponseKind::Scale(read) = &responder.kind {
                value *= read(state, cell, self)?;
            }
        }
        for responder in all {
            if let ResponseKind::Break { share, instead } = &responder.kind {
                let share = share(state, cell, self)?.clamp(0.0, 1.0);
                if share > 0.0 {
                    value = value * (1.0 - share) + instead(state, cell, self)? * share;
                }
            }
        }
        Ok(value)
    }
    fn resolve(&mut self, index: usize) -> ExecutionResult<()> {
        if self.workspace.resolved.marked(index) {
            return Ok(());
        }
        for responder in &self.book.responders[index] {
            for dependency in &responder.queries {
                self.queries.resolve(dependency)?;
            }
        }
        self.workspace.resolved.mark(index);
        Ok(())
    }
}
