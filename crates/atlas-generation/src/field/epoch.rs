use super::{shared::Scalar as S, Field};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    processes::runner::PhysicalContext,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
};
use std::io;

impl Field {
    pub fn begin_atlas_epoch() -> Command<Self> {
        let water = super::water::WaterOperations::new().begin_epoch;
        Command::with_inputs(
            "atlas.begin-epoch",
            CommandKind::Event,
            vec![],
            move |scope, _: &()| {
                let field = scope.state_mut();
                for cell in 0..field.mesh.len() {
                    field
                        .shared
                        .scalar_mut(S::ExternalHeatForcing)
                        .set(cell, 0.0)?;
                }
                scope.run(&water, &())?;
                let field = scope.state_mut();
                for name in [
                    S::OrganicBurialInput,
                    S::OrganicBurialThickness,
                    S::ExternalCoastalForcing,
                ] {
                    for cell in 0..field.mesh.len() {
                        field.shared.scalar_mut(name).set(cell, 0.0)?;
                    }
                }
                Ok(())
            },
        )
    }
    pub fn epoch_history() -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "physical-epoch-history",
            CommandKind::Event,
            vec![],
            |scope, context: &PhysicalContext| {
                scope
                    .state_mut()
                    .record_epoch(context.epoch_index)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    fn record_epoch(&mut self, epoch: i32) -> io::Result<()> {
        let mut ground = self.ground.try_borrow_mut().map_err(io::Error::other)?;
        if f64::from(epoch) != ground.completed_epochs() {
            return Err(io::Error::other(
                "Physical epoch history was applied out of order",
            ));
        }
        let heat = self.shared.scalar(S::Geothermal);
        let elevation = ground.view(G::Elevation);
        for cell in 0..self.mesh.len() {
            let history = self.shared.scalar_mut(S::GeothermalHistory);
            history.set(cell, history.get(cell)?.max(heat.get(cell)?))?;
            if epoch == 0 {
                self.shared.scalar_mut(S::FirstEpochHeight).set(
                    cell,
                    MapScale::metres(
                        elevation.get(cell)? - ground.effective_sea_level(),
                        LengthUnit::Native,
                    ),
                )?;
            }
        }
        ground.complete_epoch();
        Ok(())
    }
}
