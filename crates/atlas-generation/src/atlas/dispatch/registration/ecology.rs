use super::super::{Process, Registry, Specification};
use crate::{
    atlas::ecology::Operations,
    products::{Lifetime, ProductDefinition, Representation},
};
use std::io;

fn specification(name: &str) -> Specification {
    let requires = match name {
        "initialize" => "atlas:workspace field:Elevation",
        "burial" => "atlas:workspace atlas:ecology-response",
        "evolve" | "respond" => "atlas:workspace atlas:ecology-initialized field:Temperature field:Moisture field:FlowTargets",
        _ => "atlas:workspace atlas:ecology-initialized field:Temperature field:Moisture",
    };
    let produces = match name {
        "initialize" => "atlas:ecology-initialized ecology",
        "respond" => "atlas:ecology-response ecology",
        _ => "ecology",
    };
    let spec = Specification::new(&format!("atlas.ecology-{name}"), requires, produces, true);
    match name {
        "evolve" | "respond" => spec.elapsed(crate::bindings::DurationBinding::EpochFraction(0.5)),
        "burial" => spec.elapsed(crate::bindings::DurationBinding::EpochFraction(1.0)),
        _ => spec,
    }
}
type Select = fn(
    &Operations,
) -> &crate::execution::Command<
    crate::atlas::state::State,
    crate::processes::runner::PhysicalContext,
>;
const COMMANDS: &[(&str, Select)] = &[
    ("initialize", |o| &o.initialize),
    ("evolve", |o| &o.evolve),
    ("respond", |o| &o.respond),
    ("burial", |o| &o.burial),
    ("settle", |o| &o.settle),
];
pub fn specifications() -> Vec<Specification> {
    COMMANDS
        .iter()
        .map(|(name, _)| specification(name))
        .chain([specification("present"), human_time()])
        .collect()
}
/// The living land's step in each human era, after people have worked it.
fn human_time() -> Specification {
    Specification::new(
        "ecology.human-time",
        "atlas:workspace atlas:ecology-initialized field:Temperature field:Moisture",
        "ecology",
        true,
    )
}
pub fn response_product() -> ProductDefinition {
    let mut response = ProductDefinition::new("atlas:ecology-response", Lifetime::Epoch);
    response.representation = Some(Representation::History);
    response
}
pub fn register(registry: &mut Registry, operations: &Operations) -> io::Result<()> {
    for (name, command) in COMMANDS {
        let process = Process::command(specification(name), command(operations).clone(), |input| {
            Ok(input.physical.context)
        });
        registry.register(process)?;
    }
    registry.register(Process::query(
        specification("present"),
        operations.present.clone(),
    ))?;
    // The living land keeps changing through the human eras: woods return to abandoned
    // fields, and game thins where people hunt, over each era's years.
    registry.register(Process::command(
        human_time(),
        operations.human_time.clone(),
        |input| {
            Ok(crate::atlas::ecology::HumanTime {
                context: input.physical.context,
                years: input.epochs.last().map_or(0.0, |era| era.duration),
                // An era inside an earlier epoch lives under that epoch's ecology.
                physical_epoch: input.physical.epoch,
            })
        },
    ))?;
    registry.products.push(response_product());
    Ok(())
}
