use super::{Inputs, Occurrence, Operation};
use crate::{
    atlas::state::State,
    execution::{Command, CommandKind, Projection},
    field::{
        people::{
            crafts, era_places, identity_processes, land_events, land_processes, place_country,
            travel,
        },
        Field,
    },
};
use std::rc::Rc;

pub(super) fn watch(
    land: Rc<land_processes::Operations>,
    projection: &Projection<State, Field>,
) -> Operation {
    let watch = land.watch.projected(projection);
    Command::with_inputs(
        "human.land-watch",
        CommandKind::Event,
        vec![],
        move |scope, era: &Occurrence| {
            scope.run_with_context(&watch, &era.outer_years, Rc::new(era.physical))
        },
    )
}
pub(super) fn epoch(
    land: Rc<land_processes::Operations>,
    projection: &Projection<State, Field>,
) -> Operation {
    let epoch = land.epoch.projected(projection);
    Command::with_inputs(
        "human.land-epoch",
        CommandKind::Event,
        vec![],
        move |scope, era: &Occurrence| scope.run_with_context(&epoch, &(), Rc::new(era.physical)),
    )
}
/// Reads what the places standing at the start of an era offer and threaten, and holds it on
/// the field for the era's people. It is the only reader of the catalogue for people.
pub(super) fn place_offers(projection: &Projection<State, Field>) -> Operation {
    let hold = Field::place_offers_operation().projected(projection);
    Command::with_inputs(
        "human.place-offers",
        CommandKind::Event,
        vec![],
        move |scope, era: &Occurrence| {
            let offers = {
                let state = scope.state();
                state.clear_queries();
                Rc::new(crate::field::poi::offered::offered(
                    state,
                    &state.catalogue,
                )?)
            };
            scope.state().clear_queries();
            scope.run_with_context(&hold, &offers, Rc::new(era.physical))
        },
    )
}
pub(super) fn era(
    land: Rc<land_processes::Operations>,
    progress: crate::atlas::regional::work::Progress,
    projection: &Projection<State, Field>,
) -> Operation {
    let era = land.era.projected(projection);
    Command::with_inputs(
        "human.land-era",
        CommandKind::Elapsed,
        vec![],
        move |scope, input: &Occurrence| {
            scope.run_with_context(
                &era,
                &land_processes::Era {
                    years: input.years,
                    mobility: input.mobility,
                },
                Rc::new(input.physical),
            )?;
            let mut lines = Vec::new();
            for craft in crafts::CRAFTS {
                let mut count = 0;
                for cell in 0..scope.state().field().mesh().len() {
                    if crafts::practised(scope.state().field(), craft, cell)? > 0.05 {
                        count += 1;
                    }
                }
                lines.push(format!("{} {count}", craft.name));
            }
            progress(
                1.0,
                &format!("Crafts practised, in cells: {}", lines.join(", ")),
            );
            Ok(())
        },
    )
}
pub(super) fn places(
    record: Command<Field, era_places::Setting>,
    input: Rc<Inputs>,
    projection: &Projection<State, Field>,
) -> Operation {
    let record = record.projected(projection);
    Command::with_inputs(
        "human.places",
        CommandKind::Event,
        vec![],
        move |scope, era: &Occurrence| {
            let state: &State = scope.state();
            let settings = era_places::Setting {
                places: state.people.places.clone(),
                ways: state.people.ways.clone(),
                links: state.travel_links(),
                era: era.era.clone(),
                least: input.parameters.town_threshold,
                town: None,
                country: place_country::Setting {
                    range: travel::length(state.field(), input.parameters.city_reach)?,
                    road_travellers: input.parameters.road_traffic,
                    years: era.years,
                },
            };
            scope.run_with_context(&record, &settings, Rc::new(era.physical))
        },
    )
}
pub(super) fn identity(
    operation: Command<Field, identity_processes::Era>,
    input: Rc<Inputs>,
    projection: &Projection<State, Field>,
) -> Operation {
    let operation = operation.projected(projection);
    let name = operation.name().to_owned();
    Command::with_inputs(
        name,
        CommandKind::Elapsed,
        vec![],
        move |scope, era: &Occurrence| {
            let state: &State = scope.state();
            let parameters = &input.parameters;
            let work = identity_processes::Era {
                memory: state.people.memory.clone(),
                places: state.people.places.clone(),
                links: state.travel_links(),
                era: era.era.clone(),
                years: era.years,
                mobility: era.mobility,
                political_capacity: era.political_capacity,
                city_reach: parameters.city_reach,
                cultural_mobility: parameters.cultural_mobility,
                culture_count: parameters.culture_count as usize,
                political_reach: parameters.political_reach,
                polity_count: parameters.polity_count as usize,
            };
            scope.run_with_context(&operation, &work, Rc::new(era.physical))
        },
    )
}
pub(super) fn events(
    operation: Command<Field, land_events::Era>,
    input: Rc<Inputs>,
    projection: &Projection<State, Field>,
) -> Operation {
    let operation = operation.projected(projection);
    Command::with_inputs(
        "human.events",
        CommandKind::Event,
        vec![],
        move |scope, era: &Occurrence| {
            let state: &State = scope.state();
            let work = land_events::Era {
                memory: state.people.memory.clone(),
                events: state.people.events.clone(),
                places: state.people.places.clone(),
                ways: state.people.ways.clone(),
                links: state.travel_links(),
                era: era.era.clone(),
                years: era.years,
                town: input.parameters.town_threshold,
                random: era.random.clone(),
            };
            scope.run_with_context(&operation, &work, Rc::new(era.physical))
        },
    )
}
