use super::{
    queries::Reads,
    work::{Inputs, Occurrence, Operation},
};
use crate::{
    atlas::{
        environment::Environment,
        state::{RegionalEcology, State},
    },
    execution::{Command, CommandKind, Projection},
    field::Field,
};
use std::rc::Rc;

pub(super) fn water(
    input: Rc<Inputs>,
    environment: Rc<Environment>,
    reads: &Reads,
    field: &Projection<State, Field>,
    initialize: bool,
) -> Operation {
    let field = field.clone();
    Command::with_inputs(
        if initialize {
            "refinement.water-initialize"
        } else {
            "refinement.water-evolution"
        },
        if initialize {
            CommandKind::Initialize
        } else {
            CommandKind::Event
        },
        vec![reads.climate.dependency()],
        move |scope, step: &Occurrence| {
            let channels = if initialize && input.captured.has_small_channels {
                Some(scope.state_mut().captured_small_channels()?)
            } else {
                None
            };
            State::evolve_regional_water(
                scope,
                &field,
                &environment,
                Rc::new(step.physical),
                channels,
            )
        },
    )
}
pub(super) fn ecology(
    input: Rc<Inputs>,
    environment: Rc<Environment>,
    reads: &Reads,
    field: &Projection<State, Field>,
) -> Operation {
    let field = field.clone();
    Command::with_inputs(
        "refinement.ecology-develop",
        CommandKind::Work,
        vec![reads.climate.dependency(), reads.water.dependency()],
        move |scope, step: &Occurrence| {
            State::develop_regional_ecology(
                scope,
                &field,
                &environment,
                Rc::new(step.physical),
                &RegionalEcology {
                    seed: input.seed,
                    parameters: &input.parameters,
                    epoch: &input.ecology,
                    land_million_years: step.physical.tectonic_duration_myr,
                    authority: &input.authority,
                },
            )
        },
    )
}
