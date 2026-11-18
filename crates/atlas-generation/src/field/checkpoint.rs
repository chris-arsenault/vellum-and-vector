use super::Field;
use crate::{
    checkpoint::Archive,
    execution::{Command, CommandKind},
    transport::plan::TransportPlan,
};
use std::{cell::RefCell, io};

impl Field {
    pub(crate) fn checkpoint_coverage(&self) -> std::cell::RefMut<'_, crate::storage::Coverage> {
        self.coverage.borrow_mut()
    }
    pub(crate) fn checkpoint_operation<'a>() -> Command<Self, RefCell<Archive<'a>>> {
        Command::with_inputs(
            "field.checkpoint",
            CommandKind::Initialize,
            vec![],
            |scope, archive: &RefCell<Archive<'a>>| {
                let field: &mut Self = scope.state_mut();
                field.checkpoint(&mut archive.borrow_mut())?;
                Ok(())
            },
        )
    }
    fn checkpoint(&mut self, archive: &mut Archive<'_>) -> io::Result<()> {
        archive.label("field")?;
        self.shared.checkpoint(archive)?;
        self.ground.borrow_mut().checkpoint(archive)?;
        self.water.borrow_mut().checkpoint(archive)?;
        self.people.checkpoint(archive, self.coverage.get_mut())?;
        self.town.checkpoint(archive, self.coverage.get_mut())?;
        self.ground_load.checkpoint(archive)?;
        self.sea_load.checkpoint(archive)?;
        archive.value("tectonics", &mut self.tectonics)?;
        if archive.loading() {
            if let Some(tectonics) = &mut self.tectonics {
                tectonics.index_bonds().map_err(io::Error::other)?;
            }
        }
        archive.value("crust-formed", &mut self.crust_formed)?;
        archive.optional_band(
            "support-datum",
            &mut self.support_datum,
            self.coverage.get_mut(),
        )?;
        archive.value("faults", &mut self.faults)?;
        archive.value("events", &mut self.events)?;
        archive.value("sea-ice-epoch", &mut self.sea_ice_evolved_epoch)?;
        archive.value("last-plate-drift", &mut self.last_plate_drift_step)?;
        archive.value("province-seams", &mut self.province_seams_marked)?;
        archive.value("ecology-initialized", &mut self.ecology_initialized)?;
        archive.value("accumulated-plate-drift", &mut self.accumulated_plate_drift)?;
        archive.value("landmark-ledger", &mut self.landmark_ledger)?;
        archive.value("magic-sources", &mut self.magic_sources)?;
        let mut transport = self.transport_plan.is_some();
        archive.value("transport-plan", &mut transport)?;
        if archive.loading() {
            self.transport_plan = transport.then(|| TransportPlan::empty(self.coverage.get_mut()));
        }
        if let Some(plan) = &mut self.transport_plan {
            plan.checkpoint(archive, self.coverage.get_mut())?;
        }
        let mut seen = self.human_land_seen.is_some();
        archive.value("human-land-seen", &mut seen)?;
        if archive.loading() {
            self.human_land_seen = seen.then(|| super::people::history::Seen::new(self));
        }
        if let Some(seen) = &mut self.human_land_seen {
            seen.checkpoint(archive)?;
        }
        archive.optional_band(
            "engineered-dams",
            &mut self.engineered_dams,
            self.coverage.get_mut(),
        )?;
        for (index, band) in self.settled_place_targets.iter_mut().enumerate() {
            archive.optional_band(
                &format!("settled-place-{index}"),
                band,
                self.coverage.get_mut(),
            )?;
        }
        archive.value("thrust-slip", &mut self.thrust_slip)
        // Mesh, scale, callbacks and owner read bindings are rebuilt from the pinned request.
    }
}
