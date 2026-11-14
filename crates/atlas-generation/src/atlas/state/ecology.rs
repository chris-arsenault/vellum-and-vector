use super::{regional_ecology::habitat_dependencies, State};
use crate::{
    atlas::{
        context::EcologyEpoch, environment::Environment, history::Cause,
        parameters::AtlasParameters,
    },
    ecology::{
        history,
        lifecycle::{Advance, Authority},
    },
    execution::{CommandContext, ExecutionResult, Projection},
    field::{
        ecology::{self, world},
        Field,
    },
    processes::runner::PhysicalContext,
};
use std::{cell::RefCell, rc::Rc};

pub enum EcologyPhase {
    Evolve,
    Respond,
    HumanTime,
}
impl EcologyPhase {
    fn name(&self) -> &'static str {
        match self {
            Self::Evolve => "atlas.ecology-evolve",
            Self::Respond => "atlas.ecology-respond",
            Self::HumanTime => "ecology.human-time",
        }
    }
}
pub struct EcologicalWork<'a> {
    pub time: Advance,
    pub parameters: &'a AtlasParameters,
    pub epoch: &'a EcologyEpoch,
    pub authority: &'a Authority,
}
impl State {
    pub fn initialize_ecology(&mut self, input: &world::Establish<'_>) -> ExecutionResult<()> {
        self.physical
            .executor
            .run_with(&world::initialize(), input)?;
        self.restore_authored(false)
    }
    pub fn settle_ecology(
        scope: &mut CommandContext<'_, Self>,
        field: &Projection<Self, Field>,
        environment: &Environment,
        context: Rc<PhysicalContext>,
        input: &world::Establish<'_>,
    ) -> ExecutionResult<()> {
        scope.project(field).run_with_context(
            &world::settle(habitat_dependencies(environment)),
            input,
            context,
        )?;
        scope.state_mut().restore_authored(false)
    }
    pub fn advance_ecology(
        scope: &mut CommandContext<'_, Self>,
        field: &Projection<Self, Field>,
        environment: &Environment,
        context: Rc<PhysicalContext>,
        phase: EcologyPhase,
        mut input: EcologicalWork<'_>,
    ) -> ExecutionResult<()> {
        input.time.new_human_time = matches!(phase, EcologyPhase::HumanTime);
        if input.time.inherited && !input.time.new_human_time {
            return Ok(());
        }
        scope.state_mut().restore_authored(false)?;
        let state = scope.state();
        let forcing = state.field().ecological_forcing(
            state
                .physical
                .magic
                .as_ref()
                .map(|magic| magic.borrow())
                .as_deref()
                .map_or(&[], |magic| magic.fields.as_slice()),
            input.parameters,
            input.epoch,
        )?;
        let work = world::Elapsed {
            time: input.time,
            reset_migration: matches!(phase, EcologyPhase::Evolve),
            forcing: &forcing,
            authority: input.authority,
            transitions: RefCell::default(),
        };
        scope.project(field).run_with_context(
            &world::advance(phase.name(), habitat_dependencies(environment)),
            &work,
            context,
        )?;
        scope.state_mut().restore_authored(false)?;
        let transitions = work.transitions.into_inner();
        if !transitions.is_empty() {
            scope.state_mut().causes.push(Cause::Domain {
                process: "atlas.ecology-succession".into(),
                subjects: Vec::new(),
                description: history::describe_transitions(&transitions),
            });
        }
        Ok(())
    }
    pub fn bury_ecology(
        scope: &mut CommandContext<'_, Self>,
        field: &Projection<Self, Field>,
        environment: &Environment,
        context: Rc<PhysicalContext>,
        input: &world::Establish<'_>,
        years: f64,
    ) -> ExecutionResult<()> {
        let work = world::Burial {
            seed: input.seed,
            inherited: input.inherited,
            years,
            authority: input.authority,
            summary: RefCell::default(),
        };
        scope.project(field).run_with_context(
            &world::burial(habitat_dependencies(environment)),
            &work,
            context,
        )?;
        scope.state_mut().restore_authored(false)?;
        let summary = work
            .summary
            .into_inner()
            .expect("Completed ecological burial records its summary");
        scope.state_mut().causes.push(Cause::Domain {
            process: "atlas.ecology".into(),
            subjects: Vec::new(),
            description: summary.description(years, input.inherited),
        });
        Ok(())
    }
    pub fn present_ecology(
        &mut self,
        environment: &Environment,
        context: Rc<PhysicalContext>,
    ) -> ExecutionResult<()> {
        let query = ecology::classify_world(habitat_dependencies(environment));
        self.physical.executor.select(&query);
        self.physical.executor.query_with_context(&query, context)?;
        Ok(())
    }
}
