//! Configured magic work preserves the source supply/read/material order.
use super::{Inputs, Operations};
use crate::{
    atlas::state::State,
    execution::{Command, CommandKind, Query},
    magic::configuration::Phase,
    processes::runner::PhysicalContext,
};
use std::rc::Rc;

pub struct Work {
    pub climate: Command<State, PhysicalContext>,
    pub rocks: Command<State, PhysicalContext>,
    pub post_glacial: Command<State, PhysicalContext>,
    pub history: Command<State, Vec<usize>>,
}
fn phase(
    input: Rc<Inputs>,
    current: Query<State, ()>,
    phase: Phase,
) -> Command<State, PhysicalContext> {
    let post_glacial = phase == Phase::PostGlacial;
    let seed = input.seed;
    let supply: Command<State> = Command::with_inputs(
        "magic.source-supply",
        CommandKind::Event,
        vec![],
        move |scope, _: &()| {
            let bound = scope.values().invocation().epoch_index;
            let epoch = input.epoch(bound)?;
            scope.state_mut().supply_magic_sources(
                phase,
                seed,
                (bound >= 0).then_some(bound as usize),
                &input.activity(epoch),
            )
        },
    );
    let exchange = Command::new(
        "magic.water-exchange",
        CommandKind::Work,
        vec![],
        |state: &mut State, _| state.exchange_magic_water(),
    );
    let forcing: Command<State, f64> = Command::with_inputs(
        "magic.phase-forcing",
        CommandKind::Work,
        vec![],
        move |scope, span: &f64| {
            scope
                .state_mut()
                .apply_magic_forcing(seed, *span, post_glacial)
        },
    );
    let react: Command<State, PhysicalContext> = Command::with_inputs(
        "magic.material-response",
        CommandKind::Work,
        vec![],
        move |scope, context: &PhysicalContext| {
            scope
                .state_mut()
                .react_magic_material(seed, context.epoch_index, context.span)
        },
    );
    Command::with_inputs(
        if post_glacial {
            "atlas.magic-post-glacial"
        } else {
            "atlas.magic-climate"
        },
        CommandKind::Work,
        vec![],
        move |scope, context: &PhysicalContext| {
            let exposure = if scope.values().invocation().epoch_index >= 0 {
                context.span
            } else {
                0.0
            };
            if exposure > 0.0 {
                if post_glacial {
                    scope.run(&exchange, &())?;
                }
                scope.run(&supply, &())?;
            }
            scope.query(&current)?;
            if post_glacial || exposure > 0.0 {
                scope.run(&forcing, &exposure)?;
            }
            if post_glacial && exposure > 0.0 {
                scope.run(&react, context)?;
            }
            Ok(())
        },
    )
}
impl Work {
    pub fn new(input: Rc<Inputs>, reads: &Operations) -> Self {
        let climate = phase(input.clone(), reads.climate.clone(), Phase::Climate);
        let post_glacial = phase(input, reads.post_glacial.clone(), Phase::PostGlacial);
        let rocks: Command<State, PhysicalContext> = Command::with_inputs(
            "atlas.magic-rocks",
            CommandKind::Work,
            vec![],
            |scope, context: &PhysicalContext| {
                if scope.values().invocation().epoch_index >= 0 && context.span > 0.0 {
                    scope.state_mut().apply_magic_rocks()?;
                }
                Ok(())
            },
        );
        let classify = reads.classify.clone();
        let history: Command<State, Vec<usize>> = Command::with_inputs(
            "atlas.magic-history",
            CommandKind::Event,
            vec![],
            move |scope, ancestry: &Vec<usize>| {
                let epoch = scope.values().invocation().epoch_index;
                if epoch < 0 {
                    return Ok(());
                }
                scope.query(&classify)?;
                scope
                    .state_mut()
                    .record_classified_magic_history(epoch as usize, ancestry)
            },
        );
        Self {
            climate,
            rocks,
            post_glacial,
            history,
        }
    }
}
