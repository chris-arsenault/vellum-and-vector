use super::super::{Process, Registry, Specification};
use crate::{
    atlas::{
        magic::{work::Work, Operations},
        state::State,
    },
    execution::Command,
    magic::{configuration::System, requirements},
};
use std::io;

fn specification(name: &str, systems: &[System]) -> Specification {
    let mut spec = Specification::new(
        &format!("atlas.magic-{name}"),
        "",
        &format!("atlas:magic-{name}"),
        name != "project",
    );
    spec.contract.requires = requirements::process(name, systems);
    spec
}
type CommandSelect = fn(&Work) -> &Command<State, crate::processes::runner::PhysicalContext>;
type QuerySelect = fn(&Operations) -> &crate::execution::Query<State, ()>;
const COMMANDS: &[(&str, CommandSelect)] = &[
    ("climate", |w| &w.climate),
    ("rocks", |w| &w.rocks),
    ("post-glacial", |w| &w.post_glacial),
];
const QUERIES: &[(&str, QuerySelect)] = &[("classify", |r| &r.classify), ("coast", |r| &r.coast)];
pub fn specifications(systems: &[System]) -> Vec<Specification> {
    COMMANDS
        .iter()
        .map(|(name, _)| *name)
        .chain(QUERIES.iter().map(|(name, _)| *name))
        .chain(["initialize", "history", "project"])
        .map(|name| specification(name, systems))
        .collect()
}
pub fn register(
    registry: &mut Registry,
    reads: &Operations,
    work: &Work,
    systems: &[System],
    initialize: Command<State>,
) -> io::Result<()> {
    registry.register(Process::unit(
        specification("initialize", systems),
        initialize,
    ))?;
    for (name, command) in COMMANDS {
        registry.register(Process::command(
            specification(name, systems),
            command(work).clone(),
            |input| Ok(input.physical.context),
        ))?;
    }
    for (name, query) in QUERIES {
        registry.register(Process::query(
            specification(name, systems),
            query(reads).clone(),
        ))?;
    }
    registry.register(Process::command(
        specification("history", systems),
        work.history.clone(),
        |input| Ok(input.epoch_indices.clone()),
    ))?;
    registry.register(Process::unit(
        specification("project", systems),
        reads.project.clone(),
    ))?;
    Ok(())
}
