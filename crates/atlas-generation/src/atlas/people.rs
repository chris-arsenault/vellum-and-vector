//! Human era callers retain live place, identity and event records on the map owner.
mod built;
mod distributions;
mod land;
mod shapes;
mod territories;
mod water;
use super::{magic, parameters::AtlasParameters, physical::Physical, state::State};
use crate::{
    execution::{Command, CommandKind, Projection},
    field::{
        people::{era_places, identity_processes, land_events, land_processes, waterworks},
        Field,
    },
    processes::runner::PhysicalContext,
};
pub use built::Layout;
use std::{cell::RefCell, rc::Rc};
pub use water::Publication;

pub type Random = Rc<RefCell<dyn FnMut() -> f64>>;
pub struct Occurrence {
    pub physical: PhysicalContext,
    pub era: String,
    pub years: f64,
    pub outer_years: f64,
    pub mobility: f64,
    pub political_capacity: f64,
    pub random: Random,
}
pub struct Inputs {
    pub layout: Layout,
    pub parameters: AtlasParameters,
    pub progress: super::regional::work::Progress,
}
pub type Operation = Command<State, Occurrence>;
pub struct Operations {
    pub land: Rc<land_processes::Operations>,
    pub record: Command<Field, era_places::Setting>,
    pub watch: Operation,
    pub epoch: Operation,
    pub era: Operation,
    pub places: Operation,
    pub identity: Operation,
    pub realms: Operation,
    pub events: Operation,
    pub waterworks: Operation,
    pub water_present: Operation,
    pub magic_era: Operation,
    pub magic_present: Operation,
    pub population: Operation,
    pub cultures: Operation,
    pub politics: Operation,
    pub built: Operation,
}
impl Operations {
    pub fn new(
        input: Rc<Inputs>,
        physical: &Physical,
        magic: &magic::Operations,
        projection: &Projection<State, Field>,
        spatial: Rc<dyn crate::spatial::SpatialKernel>,
        water_publication: Rc<Publication>,
    ) -> Self {
        let owner = Rc::new(Field::human_operations());
        let questions = physical.people.clone();
        let land = Rc::new(land_processes::Operations::new(
            questions.clone(),
            owner.clone(),
            physical.rivers.clone(),
        ));
        let record =
            era_places::operation(questions.clone(), physical.rivers.clone(), owner.clone());
        let identities = identity_processes::Operations::new(
            questions.clone(),
            owner.clone(),
            physical.rivers.clone(),
            spatial,
        );
        let watch = land::watch(land.clone(), projection);
        let epoch = land::epoch(land.clone(), projection);
        let era = land::era(land.clone(), input.progress.clone(), projection);
        let places = land::places(record.clone(), input.clone(), projection);
        let identity = land::identity(identities.identity, input.clone(), projection);
        let realms = land::identity(identities.realms, input.clone(), projection);
        let event = Command::with_inputs(
            "places.human-event",
            CommandKind::Event,
            vec![],
            |scope: &mut crate::execution::CommandContext<'_, State>,
             struck: &land_events::Struck| {
                scope.state_mut().apply_place_event(struck)?;
                Ok(())
            },
        );
        let effects = Command::with_inputs(
            "places.human-event-hook",
            CommandKind::Event,
            vec![],
            move |scope, struck| scope.root_run(&event, struck),
        );
        let events = land::events(
            land_events::operation(questions, owner, effects),
            input.clone(),
            projection,
        );
        let water = Rc::new(waterworks::Operations::new(
            physical.environment.channels.clone(),
            physical.environment.river_evolution.clone(),
        ));
        let waterworks = water::advance(
            water.clone().operation(),
            input.progress.clone(),
            projection,
        );
        let water_present = water::present(
            water,
            water_publication.clone(),
            input.progress.clone(),
            projection,
        );
        let current = magic.current.clone();
        let magic_era = Command::with_inputs(
            "human.magic-era",
            CommandKind::Event,
            vec![],
            move |scope: &mut crate::execution::CommandContext<'_, State>, _: &Occurrence| {
                if scope.state().physical.magic.is_some() {
                    scope.query(&current)?;
                }
                Ok(())
            },
        );
        let project = magic.project.clone();
        let magic_present = Command::with_inputs(
            "human.magic-present",
            CommandKind::Publish,
            vec![],
            move |scope: &mut crate::execution::CommandContext<'_, State>, _: &Occurrence| {
                if scope.state().physical.magic.is_some()
                    && scope
                        .state()
                        .physical
                        .surface
                        .channels()
                        .keys()
                        .any(|name| name.starts_with("magic:"))
                {
                    scope.run(&project, &())?;
                }
                Ok(())
            },
        );
        let population = distributions::population(physical.people.support.clone(), projection);
        let cultures = distributions::cultures();
        let politics = territories::operation();
        let built = built::operation(input, water_publication);
        Self {
            land,
            record,
            watch,
            epoch,
            era,
            places,
            identity,
            realms,
            events,
            waterworks,
            water_present,
            magic_era,
            magic_present,
            population,
            cultures,
            politics,
            built,
        }
    }
}
