use super::{Inputs, Occurrence, Operation};
use crate::{
    atlas::state::State,
    execution::{Command, CommandKind, Projection},
    field::{
        people::{
            contract::{Dispatch, MapType, Rule, Timing},
            era_places, identity_processes, land_events, land_processes, place_country, travel,
        },
        Field,
    },
};
use std::rc::Rc;

const PLACE_OFFERS: Dispatch<()> = Dispatch {
    id: "human.hold-place-offers",
    rules: &[Rule::new(MapType::ALL, Some(()))],
};

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
/// Reads what the places standing at the start of an era offer and threaten, and holds it on
/// the field for the era's people. It is the only reader of the catalogue for people.
pub(super) fn place_offers(projection: &Projection<State, Field>) -> Operation {
    let hold = hold_place_offers(projection);
    Command::with_inputs(
        "human.place-offers",
        CommandKind::Event,
        vec![],
        move |scope, era: &Occurrence| scope.run_with_context(&hold, &(), Rc::new(era.physical)),
    )
}

pub(crate) fn hold_place_offers(projection: &Projection<State, Field>) -> Command<State> {
    let hold = Field::place_offers_operation().projected(projection);
    Command::with_inputs(
        PLACE_OFFERS.id,
        CommandKind::Work,
        vec![],
        move |scope: &mut crate::execution::CommandContext<'_, State>, _| {
            let state = scope.state();
            if PLACE_OFFERS
                .select(state.field().process_site(), Timing::Present)?
                .is_none()
            {
                return Ok(());
            }
            state.clear_queries();
            let offers = crate::field::poi::offered::offered(state, &state.catalogue)?;
            state.clear_queries();
            scope.run(&hold, &Rc::new(offers))
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
                timing: Timing::Elapsed,
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
