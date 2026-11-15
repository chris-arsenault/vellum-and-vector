use crate::{
    atlas::state::{CapturedRegion, State},
    execution::{Command, CommandKind},
    water::captured::DrainageNetwork,
};
use std::rc::Rc;

pub struct Capture {
    pub domains: Vec<String>,
    pub parent_span: f64,
    pub epochs: usize,
    pub rivers: Option<Rc<DrainageNetwork>>,
}
// Arconis: docs/architecture/subsystems.arconis#item=rg_child — creates the child working state on the same lattice.
pub fn operation(capture: Capture, magic: Option<Command<State>>) -> Command<State> {
    Command::with_inputs(
        "refinement.begin",
        CommandKind::Initialize,
        vec![],
        move |scope, _| {
            let state = scope.state_mut();
            let profile = state.physical.settings.profile.clone();
            state.begin_regional(
                CapturedRegion {
                    domains: capture.domains.clone(),
                    parent_span: capture.parent_span,
                    epochs: capture.epochs,
                    rivers: capture.rivers.as_deref(),
                },
                &profile,
            )?;
            if let Some(magic) = &magic {
                scope.run(magic, &())?;
            }
            scope.state_mut().prepare_regional_climate()
        },
    )
}
