use super::{Occurrence, Operation};
use crate::{
    answers::AnswerBand,
    atlas::state::State,
    execution::{Command, CommandKind, Projection, Query},
    field::{
        people::{identity_reads::shares, traditions::Kind},
        Field,
    },
};
use std::rc::Rc;
pub(super) fn population(
    support: Query<Field, AnswerBand>,
    projection: &Projection<State, Field>,
) -> Operation {
    let support = support.projected(projection);
    Command::with_inputs(
        "human.population-present",
        CommandKind::Publish,
        vec![],
        move |scope, era: &Occurrence| {
            let fed = scope.with_context(Rc::new(era.physical), |scope| scope.query(&support))?;
            let physical = &mut scope.state_mut().physical;
            let field = physical.executor.state();
            physical.surface.sample_channel(
                "populationDensity",
                "people/square-kilometre",
                |cell| field.people().people(cell),
            )?;
            physical.surface.sample_channel(
                "populationCapacity",
                "people/square-kilometre",
                |cell| fed.values().get(cell),
            )?;
            Ok(())
        },
    )
}
pub(super) fn cultures() -> Operation {
    Command::with_inputs(
        "human.cultures",
        CommandKind::Publish,
        vec![],
        |scope, _: &Occurrence| {
            let state: &mut State = scope.state_mut();
            if state.regional.is_some() {
                return Ok(());
            }
            let memory = state.people.memory.borrow();
            for kind in [Kind::Tongue, Kind::Faith, Kind::Custom] {
                let held = shares(state.field(), kind.field())?;
                for tradition in &memory.traditions.known {
                    if tradition.kind != kind {
                        continue;
                    }
                    let Some(values) = held.get(&tradition.code) else {
                        continue;
                    };
                    let Some(entity) = memory.entities.get(&tradition.entity) else {
                        continue;
                    };
                    state.physical.surface.sample_channel(
                        &format!("{}:{}", entity.kind, entity.id),
                        "ratio",
                        |cell| values.get(cell),
                    )?;
                    if kind == Kind::Tongue {
                        state.physical.surface.sample_channel(
                            &format!("languageUse:{}", entity.id),
                            "ratio",
                            |cell| values.get(cell),
                        )?;
                    }
                }
            }
            Ok(())
        },
    )
}
