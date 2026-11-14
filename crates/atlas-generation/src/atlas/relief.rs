use super::{
    dispatch::{Process, Registry, Specification},
    history::Cause,
    state::State,
};
use crate::{
    execution::{Command, CommandKind},
    field::{inheritance::Inputs, refinement::adaptive_relief},
};
use std::{cell::RefCell, io, rc::Rc};
pub fn specification() -> Specification {
    Specification::new("atlas.refine-relief", "field:Elevation", "", true)
}

pub fn register(registry: &mut Registry, inputs: Rc<Inputs>) -> io::Result<()> {
    let operation = Command::with_inputs(
        "atlas.refine-relief",
        CommandKind::Event,
        vec![],
        move |scope, seed: &i32| {
            if !inputs.surface.channels.contains_key("Elevation") {
                return Ok(());
            }
            let Some(parent) = inputs.parent.get("Elevation") else {
                return Ok(());
            };
            let state: &mut State = scope.state_mut();
            let settings = serde_json::from_value(state.physical.settings.profile.values().clone())
                .map_err(io::Error::other)?;
            let result = RefCell::default();
            state.physical.executor.run_with(
                &adaptive_relief::synthesize(),
                &adaptive_relief::Input {
                    parent,
                    seed: *seed,
                    settings: &settings,
                    result: &result,
                },
            )?;
            state.restore_authored(false)?;
            let result = result.into_inner();
            state.causes.push(Cause::Domain {
            process: "atlas.refine-relief".into(), subjects: Vec::new(),
            description: format!("Realized ridge-and-valley relief below the captured parent cells on {} cells ({} m RMS).", result.changed, result.rms_metres.round()),
        });
            Ok(())
        },
    );
    let mut process = Process::command(specification(), operation, |input| {
        Ok(input.physical.context.seed)
    });
    process.salt = 0x51ef;
    registry.register(process)
}
