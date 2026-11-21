use super::State;
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult, Projection},
    field::{
        people::{era_places, land_processes, questions::Questions, traditions::Context},
        poi::{publication::Publication, values::Moment},
        refinement::{
            causes::Registry,
            people::{self, PlaceRecords, PlaceSettings, PopulationReadout},
        },
        Field,
    },
    processes::runner::PhysicalContext,
    reconstruction::Grid,
};
use std::{io, rc::Rc};

pub struct RegionalLiving<'a> {
    pub land: &'a land_processes::Operations,
    pub questions: &'a Questions,
    pub parent: Option<&'a Grid>,
    pub context: Rc<PhysicalContext>,
}
pub struct RegionalRecording<'a> {
    pub land: &'a land_processes::Operations,
    pub record: &'a Command<Field, era_places::Setting>,
    pub settings: &'a PlaceSettings,
    pub context: Rc<PhysicalContext>,
}

impl State {
    pub fn regional_place_effects(
        scope: &mut CommandContext<'_, Self>,
        field: &Projection<Self, Field>,
        causes: &Registry<Self>,
        people: Option<RegionalLiving<'_>>,
    ) -> ExecutionResult<Option<PopulationReadout>> {
        scope.state().require_regional()?;
        scope.run(
            &Command::new(
                "regional.begin-contributions",
                CommandKind::Event,
                vec![],
                |state: &mut State, _| {
                    state.regional.as_mut().unwrap().contributions.begin()?;
                    Ok(())
                },
            ),
            &(),
        )?;
        let readout = match people {
            Some(work) => Self::live_regional_people(scope, field, work)?,
            None => None,
        };
        scope.run(
            &Command::with_inputs(
                "regional.place-effects",
                CommandKind::Event,
                vec![],
                |scope, causes: &&Registry<Self>| {
                    scope.state_mut().apply_regional_place_effects(causes)
                },
            ),
            &causes,
        )?;
        Ok(readout)
    }
    fn apply_regional_place_effects(&mut self, causes: &Registry<Self>) -> ExecutionResult<()> {
        let mut ledger = std::mem::take(&mut self.regional.as_mut().unwrap().contributions);
        let result: io::Result<()> = (|| {
            self.declare_place_effects(&mut ledger)?;
            self.commit_place_contributions(&mut ledger)
        })();
        self.regional.as_mut().unwrap().contributions = ledger;
        result?;
        causes.respond(self)?;
        Ok(())
    }
    fn regional_people_enabled(&self) -> bool {
        self.regional
            .as_ref()
            .is_some_and(|r| people::enabled(&r.domains))
    }
    pub fn prepare_regional_people(&mut self, publication: &mut Publication) -> io::Result<()> {
        if self.regional_people_enabled() {
            self.publish_places(publication, Moment::Society)?;
        }
        Ok(())
    }
    pub fn live_regional_people(
        scope: &mut CommandContext<'_, Self>,
        field: &Projection<Self, Field>,
        work: RegionalLiving<'_>,
    ) -> ExecutionResult<Option<PopulationReadout>> {
        let Some(regional) = &scope.state().regional else {
            return Ok(None);
        };
        let domains = regional.domains.clone();
        let round = regional.round;
        scope.project(field).with_context(work.context, |executor| {
            people::live(
                executor,
                work.land,
                work.questions,
                &domains,
                round,
                work.parent,
            )
        })
    }
    fn adopt_captured_people(&mut self) -> io::Result<()> {
        {
            let mut memory = self.people.memory.borrow_mut();
            let Context {
                entities,
                traditions,
                ..
            } = &mut *memory;
            traditions.restore(entities.values().cloned())?;
        }
        let regional = self
            .regional
            .as_ref()
            .ok_or_else(|| io::Error::other("Captured people require a regional map"))?;
        people::adopt_captured(
            self.field(),
            self.records.features.as_ref(),
            self.scope.area,
            &regional.evidence.seats,
            regional.parent_span,
            &mut self.people.places.borrow_mut(),
        )
    }
    pub fn record_regional_people(
        scope: &mut CommandContext<'_, Self>,
        field: &Projection<Self, Field>,
        work: RegionalRecording<'_>,
    ) -> ExecutionResult<()> {
        if !scope.state().regional_people_enabled() {
            return Ok(());
        }
        scope.run(
            &Command::new(
                "regional.adopt-people",
                CommandKind::Initialize,
                vec![],
                |state: &mut State, _| {
                    state.adopt_captured_people()?;
                    Ok(())
                },
            ),
            &(),
        )?;
        let records = PlaceRecords {
            places: scope.state().people.places.clone(),
            ways: scope.state().people.ways.clone(),
            links: scope.state().travel_links(),
        };
        scope.project(field).with_context(work.context, |executor| {
            people::record_places(executor, work.land, work.record, work.settings, records)
        })
    }
    pub fn publish_people_places(
        &mut self,
        publication: &mut Publication,
        highways: usize,
        progress: impl FnMut(f64, &str),
    ) -> io::Result<()> {
        self.publish_places(publication, Moment::Society)?;
        let catalogue = self.catalogue.clone();
        publication.late(self, &catalogue, Moment::Society)?;
        self.publish_ways(highways, progress)
    }
}
