//! Map ecology occurrences bind the existing elapsed lifecycle to current map owners.
use super::{
    context::{EcologyEpoch, Epoch},
    environment::Environment,
    parameters::AtlasParameters,
    state::{EcologicalWork, EcologyPhase, State},
};
use crate::{
    answers::AnswerBand,
    bindings::DurationBinding,
    ecology::forcing::LandUse,
    ecology::lifecycle::{Advance, Authority},
    execution::{
        Command, CommandContext, CommandKind, ExecutionResult, Executor, Projection, Query,
    },
    field::{
        ecology::{self, world},
        people::questions::Questions,
        Field,
    },
    processes::runner::PhysicalContext,
};
use std::{io, rc::Rc};

pub struct Inputs {
    pub seed: i32,
    pub epochs: Vec<Epoch>,
    pub parameters: AtlasParameters,
    pub inherited: bool,
    pub authority: Authority,
    /// How people use the land, where the map has people to ask.
    pub land_use: Option<Rc<LandUseQuestions>>,
}
impl Inputs {
    fn establish(&self) -> world::Establish<'_> {
        world::Establish {
            seed: self.seed,
            inherited: self.inherited,
            authority: &self.authority,
        }
    }
    fn epoch(&self, bound: i32) -> io::Result<(i32, EcologyEpoch)> {
        let index = if bound >= 0 {
            bound
        } else {
            i32::try_from(self.epochs.len()).map_err(io::Error::other)? - 1
        };
        let epoch = if index >= 0 {
            self.epochs
                .get(index as usize)
                .ok_or_else(|| io::Error::other("Ecology references an unknown physical epoch"))?
                .ecology
                .clone()
                .unwrap_or_default()
        } else {
            EcologyEpoch::default()
        };
        Ok((index, epoch))
    }
}
pub struct Operations {
    pub initialize: Command<State, PhysicalContext>,
    pub evolve: Command<State, PhysicalContext>,
    pub respond: Command<State, PhysicalContext>,
    pub burial: Command<State, PhysicalContext>,
    pub settle: Command<State, PhysicalContext>,
    pub present: Query<State, ()>,
    pub human_time: Command<State, HumanTime>,
}
pub struct HumanTime {
    pub context: PhysicalContext,
    pub years: f64,
    pub physical_epoch: Option<usize>,
}
/// The shared questions of how the land is used, asked of the map's field.
pub struct LandUseQuestions {
    cleared: Query<State, AnswerBand>,
    grazed: Query<State, AnswerBand>,
    hunted: Query<State, AnswerBand>,
    fished: Query<State, AnswerBand>,
}
impl LandUseQuestions {
    pub fn new(questions: &Questions, field: &Projection<State, Field>) -> Self {
        Self {
            cleared: questions.cleared.projected(field),
            grazed: questions.grazed.projected(field),
            hunted: questions.hunted.projected(field),
            fished: questions.fished.projected(field),
        }
    }
    fn ask(
        &self,
        scope: &mut CommandContext<'_, State>,
        context: PhysicalContext,
    ) -> ExecutionResult<LandUse> {
        let context = Rc::new(context);
        let mut ask = |query: &Query<State, AnswerBand>| {
            scope
                .with_context(context.clone(), |scope| scope.query(query))
                .map(|answer| answer.values())
        };
        Ok(LandUse {
            cleared: ask(&self.cleared)?,
            grazed: ask(&self.grazed)?,
            hunted: ask(&self.hunted)?,
            fished: ask(&self.fished)?,
        })
    }
}
fn land_use(
    scope: &mut CommandContext<'_, State>,
    questions: Option<&LandUseQuestions>,
    context: PhysicalContext,
) -> ExecutionResult<Option<LandUse>> {
    questions.map(|q| q.ask(scope, context)).transpose()
}
fn advance(
    scope: &mut CommandContext<'_, State>,
    field: &Projection<State, Field>,
    environment: &Environment,
    input: &Inputs,
    context: PhysicalContext,
    phase: EcologyPhase,
) -> ExecutionResult<()> {
    let used = land_use(scope, input.land_use.as_deref(), context)?;
    let years = scope
        .values()
        .invocation()
        .duration(DurationBinding::EpochFraction(0.5))
        .map_err(io::Error::other)?;
    let (epoch_index, epoch) = input.epoch(scope.values().invocation().epoch_index)?;
    State::advance_ecology(
        scope,
        field,
        environment,
        Rc::new(context),
        phase,
        EcologicalWork {
            time: Advance {
                years,
                inherited: input.inherited,
                new_human_time: false,
                land_million_years: context.tectonic_duration_myr,
                seed: input.seed,
                epoch_index,
            },
            parameters: &input.parameters,
            epoch: &epoch,
            authority: &input.authority,
            land_use: used,
        },
    )
}
impl Operations {
    pub fn new(
        input: Rc<Inputs>,
        environment: Rc<Environment>,
        field: &Projection<State, Field>,
    ) -> Self {
        let setup = input.clone();
        let initialize: Command<State, PhysicalContext> = Command::with_inputs(
            "atlas.ecology-initialize",
            CommandKind::Initialize,
            vec![],
            move |scope, _: &PhysicalContext| {
                scope.state_mut().initialize_ecology(&setup.establish())
            },
        );
        let evolve = {
            let (input, environment, field) = (input.clone(), environment.clone(), field.clone());
            Command::with_inputs(
                "atlas.ecology-evolve",
                CommandKind::Elapsed,
                vec![],
                move |scope, context: &PhysicalContext| {
                    advance(
                        scope,
                        &field,
                        &environment,
                        &input,
                        *context,
                        EcologyPhase::Evolve,
                    )
                },
            )
        };
        let respond = {
            let (input, environment, field) = (input.clone(), environment.clone(), field.clone());
            Command::with_inputs(
                "atlas.ecology-respond",
                CommandKind::Elapsed,
                vec![],
                move |scope, context: &PhysicalContext| {
                    advance(
                        scope,
                        &field,
                        &environment,
                        &input,
                        *context,
                        EcologyPhase::Respond,
                    )
                },
            )
        };
        let burial = {
            let (input, environment, field) = (input.clone(), environment.clone(), field.clone());
            Command::with_inputs(
                "atlas.ecology-burial",
                CommandKind::Elapsed,
                vec![],
                move |scope, context: &PhysicalContext| {
                    let years = scope
                        .values()
                        .invocation()
                        .duration(DurationBinding::EpochFraction(1.0))
                        .map_err(io::Error::other)?;
                    State::bury_ecology(
                        scope,
                        &field,
                        &environment,
                        Rc::new(*context),
                        &input.establish(),
                        years,
                    )
                },
            )
        };
        let settle = {
            let (input, environment, field) = (input.clone(), environment.clone(), field.clone());
            Command::with_inputs(
                "atlas.ecology-settle",
                CommandKind::Event,
                vec![],
                move |scope, context: &PhysicalContext| {
                    State::settle_ecology(
                        scope,
                        &field,
                        &environment,
                        Rc::new(*context),
                        &input.establish(),
                    )
                },
            )
        };
        let present = ecology::classify_world(
            [
                &environment.atmosphere,
                &environment.bathymetry,
                &environment.river_heat,
                &environment.floodplains,
                &environment.deltas,
            ]
            .into_iter()
            .map(Query::dependency)
            .collect(),
        )
        .projected(field);
        let field = field.clone();
        let human_time = Command::with_inputs(
            "ecology.human-time",
            CommandKind::Elapsed,
            vec![],
            move |scope, time: &HumanTime| {
                let bound = time
                    .physical_epoch
                    .map(i32::try_from)
                    .transpose()
                    .map_err(io::Error::other)?
                    .unwrap_or(-1);
                let (epoch_index, epoch) = input.epoch(bound)?;
                let used = land_use(scope, input.land_use.as_deref(), time.context)?;
                State::advance_ecology(
                    scope,
                    &field,
                    &environment,
                    Rc::new(time.context),
                    EcologyPhase::HumanTime,
                    EcologicalWork {
                        time: Advance {
                            years: time.years,
                            inherited: input.inherited,
                            new_human_time: true,
                            land_million_years: time.context.tectonic_duration_myr,
                            seed: input.seed,
                            epoch_index,
                        },
                        parameters: &input.parameters,
                        epoch: &epoch,
                        authority: &input.authority,
                        land_use: used,
                    },
                )
            },
        );
        Self {
            initialize,
            evolve,
            respond,
            burial,
            settle,
            present,
            human_time,
        }
    }
    pub fn select(&self, executor: &mut Executor<State>) {
        executor.select(&self.present);
    }
}
