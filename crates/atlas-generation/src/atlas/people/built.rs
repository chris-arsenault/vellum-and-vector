use super::{Inputs, Occurrence, Operation, Publication};
use crate::{
    atlas::{history::Cause, state::State},
    execution::{Command, CommandKind},
    field::poi::values::Moment,
};
use std::rc::Rc;

pub(super) fn operation(input: Rc<Inputs>, publication: Rc<Publication>) -> Operation {
    Command::with_inputs(
        "built.layout",
        CommandKind::Publish,
        vec![],
        move |scope, _: &Occurrence| {
            let state: &mut State = scope.state_mut();
            (input.progress)(0.0, "Laying out settlements and structures");
            let mut places = publication.places.borrow_mut();
            state.publish_places(&mut places, Moment::Society)?;
            let catalogue = state.catalogue.clone();
            places.late(state, &catalogue, Moment::Society)?;
            state.publish_ways(input.parameters.highways as usize, |part, message| {
                (input.progress)(part, message)
            })?;
            state.causes.push(Cause::Domain {
                process: "built.layout".into(),
                subjects: Vec::new(),
                description: "Settlement and structure placement follows the requested area's geography and available habitable land.".into(),
            });
            Ok(())
        },
    )
}
