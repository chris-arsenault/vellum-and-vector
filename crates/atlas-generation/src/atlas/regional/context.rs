use super::work::{command, Inputs, Occurrence, Operation};
use crate::{
    atlas::{environment::Environment, state::State},
    execution::{Command, CommandKind, Projection},
    field::{refinement::columns::ParentContacts, Field},
};
use std::rc::Rc;

pub(super) fn prepare(
    input: Rc<Inputs>,
    environment: &Environment,
    field: &Projection<State, Field>,
) -> Operation {
    let captured = input.clone();
    let prepare = command(
        "captured-context",
        CommandKind::Initialize,
        vec![],
        move |state, _| {
            state.derive_regional_character()?;
            state.prepare_regional_people(&mut captured.publication.borrow_mut())?;
            state.read_regional_evidence(&captured.causes)?;
            let parent = &captured.captured;
            state.prepare_regional_columns(ParentContacts {
                grid: &parent.grid,
                count: parent.grid.measures.len(),
                bedrock: &parent.bedrock,
                share: &parent.share,
                depth: &parent.depth,
            })
        },
    );
    let withdrawal = environment.withdrawal.projected(field);
    let transmission = environment.transmission.projected(field);
    let root_hold = environment.root_hold.projected(field);
    let grow: Operation = Command::with_inputs(
        "refinement.network",
        CommandKind::Initialize,
        vec![],
        move |scope, _: &Occurrence| {
            let withdrawal = scope.query(&withdrawal)?.values();
            let transmission = scope.query(&transmission)?.values();
            let roots = scope.query(&root_hold)?.values();
            let state = scope.state_mut();
            state.grow_regional_network(
                &input.causes,
                input.seed,
                withdrawal,
                transmission,
                roots,
            )?;
            input.causes.support(state)?;
            state.clear_queries();
            Ok(())
        },
    );
    Command::with_inputs(
        "refinement.context",
        CommandKind::Initialize,
        vec![],
        move |scope, step| {
            scope.run(&prepare, step)?;
            scope.run(&grow, step)?;
            Ok(super::city::trace_footprint(
                scope.state(),
                "inherited population",
            )?)
        },
    )
}
pub(super) fn relief(
    input: Rc<Inputs>,
    environment: &Environment,
    field: &Projection<State, Field>,
) -> Operation {
    let root_hold = environment.root_hold.projected(field);
    Command::with_inputs(
        "refinement.relief",
        CommandKind::Initialize,
        vec![],
        move |scope, _: &Occurrence| {
            let roots = scope.query(&root_hold)?.values();
            let state = scope.state_mut();
            state.clear_queries();
            let result = state.start_regional_ground(&input.captured.grid, &input.causes, roots);
            state.clear_queries();
            result
        },
    )
}
