use super::super::{Feedback, Schedule, SemanticRegistration};
use super::super::{Input, Process, Registry, Specification};
use crate::field::people::{
    facts::{passes_for, Facts},
    feed, gather, goods, land, pass,
};
use crate::{
    atlas::people::{Occurrence, Operations},
    execution::ExecutionResult,
};
use crate::{
    atlas::state::State,
    execution::Projection,
    field::{
        people::{
            contract::{Contract, NoSource, Source},
            history::{HazardStart, MEET_GROUND},
        },
        Field,
    },
};
use std::{cell::RefCell, io, rc::Rc};

fn registration<A: 'static, I: Source + 'static, B: Source + 'static>(
    owner: Contract<A, I, B>,
    schedule: Schedule,
) -> SemanticRegistration<A, I, B> {
    SemanticRegistration {
        owner,
        module: "society",
        schedule,
        requires: "atlas:workspace",
        produces: "",
    }
}
fn hazards() -> SemanticRegistration<(), HazardStart, NoSource> {
    registration(MEET_GROUND, Schedule::default())
}

fn pass_slot(order: i32, spatial: bool) -> Schedule {
    Schedule {
        stage: Some("society"),
        order,
        after: &[],
        feedback: spatial.then(|| Feedback {
            name: "settlement differentiation",
            iterations: std::num::NonZeroUsize::new(3).unwrap(),
        }),
    }
}

fn facts(input: &Input) -> Facts {
    match input.epochs.last() {
        Some(era) if era.variables.contains_key("mobility") => Facts::settled(
            era.duration / passes_for(era.duration) as f64,
            era.variables["mobility"].as_f64().unwrap_or(1.0),
        ),
        Some(era) => Facts::loose(era.duration),
        None => Facts::settled(0.0, 1.0),
    }
}

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
        "human.place-offers",
        |o| &o.place_offers,
        "atlas:workspace",
        "",
        true,
        false,
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
// Preflight and the runner visit the same process owners, command bindings and slots.
macro_rules! society {
    ($visit:ident,$regional:expr) => {{
        $visit!(goods::TRADE, trade, pass_slot(0, $regional));
        $visit!(feed::PROVISION, feed, pass_slot(1, $regional));
        $visit!(land::DEMOGRAPHY, grow, pass_slot(2, false));
        $visit!(gather::MOVEMENT, gather, pass_slot(3, $regional));
        $visit!(land::BUILT_GROUND, harden, pass_slot(4, $regional));
        $visit!(land::MAINTENANCE, maintenance, pass_slot(5, $regional));
    }};
}

pub fn specifications(regional: bool) -> Vec<Specification> {
    let mut specs: Vec<_> = DEFINITIONS.iter().map(specification).collect();
    specs.extend([
        hazards().specification(),
        Specification::new("human.land-settle", "atlas:workspace", "", true),
        Specification::new("human.layers.dwell", "atlas:workspace", "", true),
    ]);
    macro_rules! describe {
        ($owner:expr,$command:ident,$slot:expr) => {
            specs.push(registration($owner, $slot).specification())
        };
    }
    society!(describe, regional);
    specs
}
pub fn register(
    registry: &mut Registry,
    operations: &Operations,
    field: &Projection<State, Field>,
    regional: bool,
    parent: crate::field::refinement::people::Parent,
    seed: i32,
) -> io::Result<()> {
    registry.register(Process::semantic_command(
        &hazards(),
        operations.land.meet.projected(field),
        |_, strategy| Ok(strategy),
    ))?;
    let pass = &operations.land.pass;
    for command in [&pass.settle, &pass.dwell] {
        registry.register(Process::command(
            Specification::new(command.name(), "atlas:workspace", "", true),
            command.projected(field),
            |input| Ok(facts(input)),
        ))?;
    }
    macro_rules! projected {
        (gather) => {
            crate::atlas::regional::city::gather(pass.gather.projected(field), seed)
        };
        ($command:ident) => {
            pass.$command.projected(field)
        };
    }
    macro_rules! register_owner {
        ($owner:expr,$command:ident,$slot:expr) => {{
            let parent = parent.clone();
            registry.register(Process::semantic_command(
                &registration($owner, $slot),
                projected!($command),
                move |input, strategy| {
                    Ok(pass::Inputs {
                        facts: facts(input),
                        parent: parent.clone(),
                        city: None,
                        strategy,
                    })
                },
            ))?
        }};
    }
    society!(register_owner, regional);
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
