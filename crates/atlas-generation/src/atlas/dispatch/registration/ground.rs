//! Real-scale ground detail (ADR 0016, `processes/ground`): each step is a registered command
//! on the common process interface, run only by the real-scale sequence.
use super::super::{Process, Registry, Specification};
use crate::{
    atlas::state::State,
    execution::{Command, CommandKind},
};
use std::io;

type Step = fn(&mut State) -> io::Result<()>;
/// The steps in the order the real-scale sequence runs them, with what each does.
pub const STEPS: [(&str, Step); 5] = [
    // Pools on the drawn channels, which the water model sized at their real width, through
    // the place catalogue.
    ("real-scale.pools", State::publish_pools),
    // Exposed rock and cliffs.
    ("real-scale.rock", State::publish_exposed_rock),
    // Trails from unreached places to the ways, once the settlement's streets exist.
    ("real-scale.trails", State::lay_trails),
    // Fords and bridges where every way, trails included, meets a channel.
    ("real-scale.crossings", State::publish_crossings),
    // Single plants and stones on maps fine enough to show them.
    ("real-scale.cover", State::scatter_cover),
];
pub fn specifications() -> Vec<Specification> {
    STEPS
        .iter()
        .map(|(id, _)| Specification::new(id, "atlas:workspace", "", false))
        .collect()
}
pub fn register(registry: &mut Registry) -> io::Result<()> {
    for (id, step) in STEPS {
        let command =
            Command::with_inputs(id, CommandKind::Publish, vec![], move |scope, _: &()| {
                step(scope.state_mut())?;
                Ok(())
            });
        registry.register(Process::command(
            Specification::new(id, "atlas:workspace", "", false),
            command,
            |_| Ok(()),
        ))?;
    }
    Ok(())
}
