use super::{Regional, State};
use crate::{
    checkpoint::Archive,
    execution::{Command, CommandKind, ExecutionResult},
    field::{climate::regional::Capture, Field},
    storage::Coverage,
};
use std::{cell::RefCell, io};

impl State {
    pub(crate) fn checkpoint_operation<'a>() -> Command<Self, RefCell<Archive<'a>>> {
        Command::with_inputs(
            "atlas.checkpoint",
            CommandKind::Initialize,
            vec![],
            |scope, archive: &RefCell<Archive<'a>>| {
                let state: &mut Self = scope.state_mut();
                state.checkpoint(archive)
            },
        )
    }
    fn checkpoint(&mut self, archive: &RefCell<Archive<'_>>) -> ExecutionResult<()> {
        self.physical
            .executor
            .run_with(&Field::checkpoint_operation(), archive)?;
        let archive = &mut *archive.borrow_mut();
        archive.label("atlas")?;
        // Read-only bindings and callbacks remain attached to their restored owners.
        self.physical.surface.checkpoint(archive)?;
        archive.value("ocean", &mut self.physical.ocean)?;
        archive.value("lakes", &mut self.physical.lakes)?;
        archive.value("lake-outlines", &mut self.physical.lake_outlines)?;
        archive.value("landmarks", &mut self.physical.landmarks)?;
        archive.value("landmark-roster", &mut self.physical.landmark_roster)?;
        let field = self.physical.executor.state();
        let mut coverage = field.checkpoint_coverage();
        if let Some(magic) = &mut self.physical.magic {
            archive.label("magic-present")?;
            magic.get_mut().checkpoint(archive, &mut coverage)?;
        } else {
            archive.label("no-magic")?;
        }
        self.records.checkpoint(archive)?;
        archive.value("places", &mut *self.people.places.borrow_mut())?;
        archive.value("town-fabric", &mut self.town)?;
        archive.value("ways", &mut *self.people.ways.borrow_mut())?;
        archive.value("events", &mut *self.people.events.borrow_mut())?;
        archive.value("works", &mut *self.people.works.borrow_mut())?;
        let memory = &mut *self.people.memory.borrow_mut();
        archive.value("entities", &mut memory.entities)?;
        archive.value("traditions", &mut memory.traditions)?;
        if archive.loading() {
            for entity in memory.entities.values() {
                memory.naming.remember(entity)?;
            }
        }
        if let Some(regional) = &mut self.regional {
            archive.label("regional")?;
            regional.checkpoint(archive, &mut coverage)?;
        } else {
            archive.label("world")?;
        }
        archive.value("history", &mut self.history)?;
        archive.value("causes", &mut self.causes)?;
        archive.value("diagnostics", &mut self.diagnostics)?;
        archive.value("drainage", &mut self.drainage)?;
        archive.value(
            "retained-domains",
            self.retained_continental_domains.get_mut(),
        )?;
        archive.value("varieties", &mut self.varieties)?;
        archive.value("fall-sizes", &mut self.fall_sizes)?;
        self.place_effects.checkpoint(archive, &mut coverage)?;
        self.clear_queries();
        Ok(())
    }
}
impl Regional {
    fn checkpoint(&mut self, archive: &mut Archive<'_>, coverage: &mut Coverage) -> io::Result<()> {
        // Domains, parent span and inherited height are immutable captured inputs.
        archive.value("round", &mut self.round)?;
        archive.value("evidence", &mut self.evidence)?;
        archive.value("network", &mut self.network)?;
        archive.value("basin", &mut self.basin)?;
        archive.value("continuing-rivers", &mut self.continuing_rivers)?;
        archive.value("character", &mut self.character)?;
        archive.value("contacts", &mut self.contacts)?;
        archive.value("drainage", self.drainage.get_mut())?;
        let mut climate = self.climate.is_some();
        archive.value("climate", &mut climate)?;
        if archive.loading() {
            self.climate = climate.then(|| Capture::checkpoint_new(coverage));
        }
        if let Some(climate) = &mut self.climate {
            climate.checkpoint(archive)?;
        }
        archive.optional_read(
            "small-channel-length",
            &mut self.small_channel_length,
            coverage,
        )?;
        archive.value("media", self.media.get_mut())?;
        self.contributions.checkpoint(archive, coverage)?;
        archive.value("removed-products", &mut self.removed_products)?;
        archive.value("city", &mut self.city)
    }
}
