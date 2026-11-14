use super::WorkspaceInput;
use crate::{
    execution::{Command, CommandKind},
    field::Field,
    magic::{configuration::Phase, sources::run::Supply, workspace::Activity},
    spatial::SpatialKernel,
};

pub struct Input<'a> {
    pub workspace: WorkspaceInput<'a>,
    pub seed: i32,
    pub epoch: i32,
    pub activity: &'a [Activity],
    pub spatial: &'a dyn SpatialKernel,
}
pub fn phase<'a>(phase: Phase) -> Command<Field, Input<'a>> {
    operation("magic.source-supply", Some(phase))
}
pub fn society<'a>() -> Command<Field, Input<'a>> {
    operation("magic.people-event-supply", None)
}
fn operation<'a>(name: &str, phase: Option<Phase>) -> Command<Field, Input<'a>> {
    Command::with_inputs(
        name,
        CommandKind::Event,
        vec![],
        move |scope, input: &Input<'_>| {
            scope.state_mut().with_magic(|env, water, _, _, people| {
                let mut supply = Supply {
                    seed: input.seed,
                    epoch: input.epoch,
                    activity: 1.0,
                    deaths: &mut |cell| people.take_deaths(cell),
                    water,
                    kernel: input.spatial,
                };
                let mut workspace = input.workspace.borrow_mut();
                match phase {
                    Some(phase) => workspace.supply_phase(env, &mut supply, phase, input.activity),
                    None => workspace.supply_society_events(env, &mut supply, input.activity),
                }
            })?;
            Ok(())
        },
    )
}
