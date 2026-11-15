//! One map execution scope for numerical owners and queries over current map records.
use super::{
    context::BoundPhysicalContext,
    environment::Environment,
    native::{NativeStep, NativeSteps},
    state::State,
    terrain::Terrain,
};
use crate::{
    answers::QuestionBook,
    execution::{
        Command, CommandKind, ExecutionResult, Executor, Projection, Query, QueryValue, ReadContext,
    },
    field::{poi::water_influences, shared::Scalar, Field},
};

pub struct Runtime {
    pub executor: Executor<State>,
    field: Projection<State, Field>,
}
impl Runtime {
    // Arconis: docs/architecture/subsystems.arconis#item=m_carry — moves magic with the crust after each plate step.
    pub fn plate_magic_hook() -> Command<Field, crate::processes::runner::PhysicalContext> {
        let carry = Command::new(
            "atlas.carry-magic-crust",
            CommandKind::Event,
            vec![],
            |state: &mut State, _| state.advect_magic(),
        );
        Command::with_inputs(
            "atlas.after-plate-step",
            CommandKind::Event,
            vec![],
            move |scope, _| scope.root_run(&carry, &()),
        )
    }
    pub fn new(state: State) -> Self {
        let field = Projection::new(
            |state: &State| &state.physical.executor,
            |state: &mut State| &mut state.physical.executor,
        )
        .state();
        Self {
            executor: Executor::new(state),
            field,
        }
    }
    pub fn field_projection(&self) -> &Projection<State, Field> {
        &self.field
    }
    pub fn select_physical<'a>(
        &mut self,
        definitions: &NativeSteps,
        environment: &Environment,
        terrain: &Terrain,
        seed: i32,
        selected: impl IntoIterator<Item = &'a str>,
    ) -> ExecutionResult<()> {
        let mut selection = self.executor.selection_in(&self.field);
        environment.select_in(&mut selection, seed, |_| None);
        terrain.select_in(&mut selection, seed, |_| None);
        for name in selected {
            definitions.get(name)?.select_in(&mut selection, seed);
        }
        Ok(())
    }
    /// A selected specialization reads the current map owner even when requested by a field command.
    pub fn bind_field_query<T: QueryValue>(
        &mut self,
        query: &Query<Field, T>,
        read: impl Fn(&State, &ReadContext<'_, State>) -> ExecutionResult<T> + 'static,
    ) {
        self.executor.bind(&query.projected(&self.field), read);
    }
    pub fn bind_regional_climate(
        &mut self,
        environment: &Environment,
        atmosphere: Query<State, ()>,
    ) {
        self.bind_field_query(&environment.atmosphere, move |_, reader| {
            reader.get(&atmosphere)?;
            Ok(())
        });
    }
    pub fn bind_regional_ocean_distance(&mut self, environment: &Environment) {
        self.bind_field_query(&environment.distance, |state, _| {
            state.refresh_regional_ocean_distance()?;
            Ok(state.field().shared().scalar(Scalar::OceanDistance))
        });
    }
    pub fn bind_regional_water(&mut self, environment: &Environment) {
        self.executor
            .bind_before(&environment.conditioning.projected(&self.field), |state| {
                state.update_regional_slopes()?;
                Ok(())
            });
        self.executor
            .bind_after(&environment.rivers.projected(&self.field), |state| {
                state.read_regional_drainage()?;
                Ok(())
            });
    }
    pub fn bind_coastal_forcing(&mut self, terrain: &Terrain) {
        self.bind_field_query(&terrain.coastal_forcing, |state, _| {
            state
                .field()
                .external_coastal_pressure(&state.physical.surface)?;
            if let Some(magic) = &state.physical.magic {
                state.field().current_magic_coast(&mut magic.borrow_mut())?;
            }
            Ok(())
        });
    }
    pub fn bind_magic(
        &mut self,
        input: std::rc::Rc<super::magic::Inputs>,
        environment: &Environment,
        terrain: &Terrain,
    ) -> super::magic::Operations {
        let operations = super::magic::Operations::new(input, environment, terrain, &self.field);
        operations.select(&mut self.executor);
        self.bind_coastal_forcing(terrain);
        operations
    }
    pub fn place_water_responders(
        &mut self,
        book: &mut QuestionBook<Field, &'static str>,
    ) -> ExecutionResult<()> {
        let records = Query::new("places.water-records", vec![], |state: &State, _| {
            state.refresh_place_influences()?;
            Ok(())
        });
        self.executor.select(&records);
        let refresh = Query::new(
            "places.water-influences",
            vec![],
            move |_: &Field, reader| {
                reader.root_query(&records)?;
                Ok(())
            },
        );
        self.executor.selection_in(&self.field).select(&refresh);
        water_influences::respond(book, self.executor.state().place_water(), refresh)
    }
    pub fn apply_native(
        &mut self,
        step: &NativeStep,
        bound: &BoundPhysicalContext,
    ) -> ExecutionResult<()> {
        self.executor.set_invocation(crate::bindings::Invocation {
            epoch_index: bound.epoch.map_or(-1, |epoch| epoch as i32),
            ..self.executor.invocation()
        });
        self.executor.state().clear_queries();
        let restore = Command::new(
            "atlas.restore-authored",
            CommandKind::Event,
            vec![],
            |state: &mut State, _| state.restore_authored(true),
        );
        if step.kind().is_some() {
            self.executor.run(&restore)?;
        }
        let result = step
            .projected(&self.field)
            .run(&mut self.executor, bound.context);
        self.executor.state().clear_queries();
        result?;
        if step.kind().is_some() {
            self.executor.run(&restore)?;
        }
        let name = step.name;
        let epoch = bound.context.epoch_index;
        if matches!(name, "physical-epoch-history" | "landform-classification") {
            self.executor.run(&Command::new(
                "atlas.after-physical-step",
                CommandKind::Event,
                vec![],
                move |state: &mut State, _| state.after_physical_step(name, epoch),
            ))?;
        }
        Ok(())
    }
}
