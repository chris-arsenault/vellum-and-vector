//! The settlement catalogue's existing read, influence, support, grading and relocation hooks.
use super::State;
use crate::{
    execution::{Command, CommandKind},
    features::FeatureWorkspace,
    field::{
        poi::reads::has_channel,
        refinement::{
            causes::{Cause, Schedule},
            network::scale_around,
            people,
            seats::{Seat, Situation},
        },
        Field,
    },
};
use std::{cell::RefCell, io, rc::Rc};

#[derive(Clone, Copy)]
enum Step {
    Support,
    Restore,
    Respond,
}
struct Work<'a> {
    features: RefCell<&'a mut dyn FeatureWorkspace>,
    seats: RefCell<&'a mut [Seat]>,
    receiver: &'a [i32],
    basin: &'a [u8],
    parent_span: f64,
}
fn operation<'a>(step: Step) -> Command<Field, Work<'a>> {
    let name = match step {
        Step::Support => "support",
        Step::Restore => "restore",
        Step::Respond => "respond",
    };
    Command::with_inputs(
        format!("regional.settlements.{name}"),
        CommandKind::Work,
        vec![],
        move |context, input: &Work<'_>| {
            if matches!(step, Step::Support) {
                context.state_mut().draw_channels_to_seats(
                    &**input.features.borrow(),
                    &input.seats.borrow(),
                    input.receiver,
                )?;
                return Ok(());
            }
            let field = context.state_mut();
            let channel = (0..field.mesh().len())
                .map(|cell| has_channel(field, cell).map(u8::from))
                .collect::<io::Result<Vec<_>>>()?;
            match step {
                Step::Restore => {
                    for seat in input.seats.borrow().iter() {
                        field.grade_seat(
                            seat.cell,
                            seat.radius,
                            seat.gradient,
                            &channel,
                            input.basin,
                        )?;
                    }
                }
                Step::Respond => field.settle_seats(
                    &mut **input.features.borrow_mut(),
                    &mut input.seats.borrow_mut(),
                    input.parent_span,
                    &channel,
                    input.basin,
                )?,
                Step::Support => unreachable!(),
            }
            Ok(())
        },
    )
}
fn act(state: &mut State, step: Step) -> io::Result<()> {
    let regional = state.regional.as_mut().ok_or_else(|| {
        io::Error::other("Settlement refinement requires regional initialization")
    })?;
    if matches!(step, Step::Respond) && !people::enabled(&regional.domains) {
        return Ok(());
    }
    let count = state.physical.executor.state().mesh().len();
    let empty = vec![0; count];
    let receiver = regional
        .network
        .as_ref()
        .map(|n| n.tree.receiver.as_slice())
        .unwrap_or(&[]);
    if matches!(step, Step::Support) && receiver.len() != count {
        return Err(io::Error::other(
            "River-side seat support requires the initial drainage proposal",
        ));
    }
    let input = Work {
        features: RefCell::new(state.records.features.as_mut()),
        seats: RefCell::new(&mut regional.evidence.seats),
        receiver,
        basin: regional.basin.as_deref().unwrap_or(&empty),
        parent_span: regional.parent_span,
    };
    state
        .physical
        .executor
        .run_with(&operation(step), &input)
        .map_err(|e| io::Error::other(format!("{e:?}")))?;
    state.held.release();
    Ok(())
}
pub(super) fn schedule() -> Schedule<State> {
    let mut cause: Cause<State> = Cause::new("settlement");
    cause.read = Some(Rc::new(|state, evidence| {
        let regional = state.regional.as_ref().ok_or_else(|| {
            io::Error::other("Settlement capture requires regional initialization")
        })?;
        evidence.seats.extend(state.field().known_seats(
            state.records.features.as_ref(),
            &state.scope.area,
            regional.parent_span,
        )?);
        Ok(())
    }));
    cause.influence = Some(Rc::new(|state, cost| {
        let regional = state.regional.as_ref().ok_or_else(|| {
            io::Error::other("Settlement influence requires regional initialization")
        })?;
        for seat in &regional.evidence.seats {
            if seat.situation == Situation::River {
                scale_around(
                    state.field().mesh(),
                    cost,
                    seat.cell,
                    2.0 * state.field().scale().cells(1.0),
                    0.5,
                );
            }
        }
        Ok(())
    }));
    cause.support = Some(Rc::new(|state| act(state, Step::Support)));
    cause.restore = Some(Rc::new(|state| act(state, Step::Restore)));
    cause.respond = Some(Rc::new(|state| act(state, Step::Respond)));
    Rc::new(cause)
}
