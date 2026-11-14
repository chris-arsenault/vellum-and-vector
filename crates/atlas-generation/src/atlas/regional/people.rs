use super::{
    queries::Reads,
    work::{Inputs, Occurrence, Operation},
};
use crate::{
    atlas::state::{RegionalLiving, RegionalRecording, State},
    execution::{Command, CommandKind, Projection},
    field::{refinement::people, Field},
};
use std::rc::Rc;

pub(super) fn effects(
    input: Rc<Inputs>,
    reads: &Reads,
    field: &Projection<State, Field>,
) -> Operation {
    let field = field.clone();
    Command::with_inputs(
        "refinement.place-effects",
        CommandKind::Event,
        vec![reads.climate.dependency(), reads.water.dependency()],
        move |scope, step: &Occurrence| {
            let work = &input.people;
            let living = step.people.then(|| RegionalLiving {
                land: &work.land,
                questions: &work.questions,
                parent: work.parent.as_deref(),
                context: Rc::new(step.physical),
            });
            if let Some(readout) =
                State::regional_place_effects(scope, &field, &input.causes, living)?
            {
                (input.progress)(1.0, &readout.land);
                (input.progress)(1.0, &readout.message());
            }
            Ok(())
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
                    land: &work.land,
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
