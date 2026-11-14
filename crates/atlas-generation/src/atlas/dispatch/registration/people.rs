use super::super::{Input, Process, Registry, Specification};
use crate::{
    atlas::people::{Occurrence, Operations},
    execution::ExecutionResult,
};
use std::{cell::RefCell, io, rc::Rc};

fn occurrence(input: &Input, elapsed: bool) -> ExecutionResult<Occurrence> {
    let last = input.epochs.last();
    if elapsed && last.is_none() {
        return Err(io::Error::other("Human elapsed work requires an enclosing era").into());
    }
    let random = input.random.clone();
    let variable = |name| {
        last.and_then(|epoch| epoch.variables.get(name))
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(1.0)
    };
    Ok(Occurrence {
        physical: input.physical.context,
        era: last.map_or("present", |epoch| epoch.id.as_str()).to_owned(),
        years: last.map_or(0.0, |epoch| epoch.duration),
        outer_years: input.epochs.first().map_or(0.0, |epoch| epoch.duration),
        mobility: variable("mobility"),
        political_capacity: variable("politicalCapacity"),
        random: Rc::new(RefCell::new(move || random.borrow_mut().sample(false))),
    })
}
type Operation = crate::execution::Command<crate::atlas::state::State, Occurrence>;
type Select = fn(&Operations) -> &Operation;
type Definition = (&'static str, Select, &'static str, &'static str, bool, bool);
const DEFINITIONS: &[Definition] = &[
    (
        "human.land-watch",
        |o| &o.watch,
        "atlas:workspace",
        "",
        true,
        false,
    ),
    (
        "human.land-epoch",
        |o| &o.epoch,
        "atlas:workspace",
        "",
        true,
        false,
    ),
    (
        "human.land-era",
        |o| &o.era,
        "atlas:workspace",
        "",
        true,
        true,
    ),
    (
        "human.places",
        |o| &o.places,
        "atlas:workspace",
        "",
        true,
        false,
    ),
    (
        "human.identity-era",
        |o| &o.identity,
        "atlas:workspace",
        "",
        true,
        true,
    ),
    (
        "human.realm-era",
        |o| &o.realms,
        "atlas:workspace",
        "",
        true,
        true,
    ),
    (
        "human.events",
        |o| &o.events,
        "atlas:workspace",
        "",
        true,
        false,
    ),
    (
        "human.waterworks",
        |o| &o.waterworks,
        "atlas:workspace",
        "",
        true,
        false,
    ),
    (
        "human.magic-era",
        |o| &o.magic_era,
        "atlas:workspace",
        "",
        true,
        false,
    ),
    (
        "human.water-present",
        |o| &o.water_present,
        "atlas:workspace",
        "",
        false,
        false,
    ),
    (
        "human.magic-present",
        |o| &o.magic_present,
        "atlas:workspace",
        "",
        false,
        false,
    ),
    (
        "human.population-present",
        |o| &o.population,
        "atlas:workspace",
        "population",
        false,
        false,
    ),
    (
        "human.cultures",
        |o| &o.cultures,
        "",
        "cultures",
        false,
        false,
    ),
    (
        "human.politics",
        |o| &o.politics,
        "",
        "politics",
        false,
        false,
    ),
    ("built.layout", |o| &o.built, "", "built", false, false),
];
fn specification(&(name, _, requires, produces, workspace, elapsed): &Definition) -> Specification {
    let mut result = Specification::new(name, requires, produces, workspace);
    if elapsed {
        result = result.elapsed(crate::bindings::DurationBinding::EpochFraction(1.0));
    }
    result
}
pub fn specifications() -> Vec<Specification> {
    DEFINITIONS.iter().map(specification).collect()
}
pub fn register(registry: &mut Registry, operations: &Operations) -> io::Result<()> {
    for definition in DEFINITIONS {
        let spec = specification(definition);
        let elapsed = spec.duration.is_some();
        registry.register(Process::command(
            spec,
            definition.1(operations).clone(),
            move |input| occurrence(input, elapsed),
        ))?;
    }
    Ok(())
}
