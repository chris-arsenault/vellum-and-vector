use super::{
    queries::Reads,
    work::{Inputs, Occurrence, Operation},
};
use crate::{
    atlas::state::{RegionalRecording, State},
    execution::{Command, CommandKind, Projection},
    field::{refinement::people, Field},
};
use std::rc::Rc;

pub(super) fn effects(
    input: Rc<Inputs>,
    reads: &Reads,
    field: &Projection<State, Field>,
) -> Operation {
    let offers = crate::atlas::people::hold_place_offers(field);
    Command::with_inputs(
        "refinement.place-effects",
        CommandKind::Event,
        vec![reads.climate.dependency(), reads.water.dependency()],
        move |scope, step: &Occurrence| {
            if step.people {
                scope.run_with_context(&offers, &(), Rc::new(step.physical))?;
            }
            State::regional_place_effects(scope, &input.causes)
        },
    )
}
pub(super) fn publish(
    input: Rc<Inputs>,
    reads: &Reads,
    field: &Projection<State, Field>,
) -> Operation {
    let field = field.clone();
    Command::with_inputs(
        "refinement.places",
        CommandKind::Publish,
        vec![reads.habitats.dependency(), reads.water.dependency()],
        move |scope, step: &Occurrence| {
            if !scope
                .state()
                .regional
                .as_ref()
                .is_some_and(|r| people::enabled(&r.domains))
            {
                return Ok(());
            }
            let work = &input.people;
            State::record_regional_people(
                scope,
                &field,
                RegionalRecording {
                    record: &work.record,
                    settings: &work.settings,
                    context: Rc::new(step.physical),
                },
            )?;
            scope.state_mut().publish_people_places(
                &mut input.publication.borrow_mut(),
                input.parameters.highways as usize,
                |value, text| (input.progress)(value, text),
            )?;
            Ok(())
        },
    )
}
