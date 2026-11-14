use super::{
    crust_settings::Settings,
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    metric::search::physical_distance,
    processes::runner::PhysicalContext,
    rock::ground::GroundField,
    tectonics::controls::OCEAN_MATURITY_MYR,
};
use std::io;
const UNREACHABLE: f64 = 2_147_483_647.0;

fn failure(error: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
impl Field {
    pub fn tectonic_epoch() -> Command<Self> {
        Command::new(
            "tectonic-epoch-activity",
            CommandKind::Event,
            vec![],
            |field: &mut Field, _| {
                for cell in 0..field.mesh.len() {
                    let code = field
                        .shared
                        .code(C::InitialTectonicBoundaryCodes)
                        .get(cell)
                        .map_err(failure)?;
                    let strain = field
                        .shared
                        .scalar(S::InitialTectonicStrain)
                        .get(cell)
                        .map_err(failure)?;
                    let active = code != 0 && strain != 0.0;
                    field
                        .shared
                        .code_mut(C::TectonicBoundaryCodes)
                        .set(cell, if active { code } else { 0 })
                        .map_err(failure)?;
                    field
                        .shared
                        .scalar_mut(S::TectonicStrain)
                        .set(cell, if active { strain } else { 0.0 })
                        .map_err(failure)?;
                }
                Ok(())
            },
        )
    }
    pub fn tectonic_margins(settings: Settings) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "tectonic-margins",
            CommandKind::Event,
            vec![],
            move |scope, context| {
                scope
                    .state_mut()
                    .update_margins(&settings, context)
                    .map_err(failure)
            },
        )
    }
    fn update_margins(&mut self, p: &Settings, context: &PhysicalContext) -> io::Result<()> {
        let coverage = self.coverage.get_mut();
        let mut distance = coverage.allocate(UNREACHABLE);
        let mut spreading = coverage.allocate(UNREACHABLE);
        let mut kind = coverage.allocate(0i32);
        let mut boundaries = Vec::new();
        let mut openings = Vec::new();
        let codes = self.shared.code(C::TectonicBoundaryCodes);
        for cell in 0..self.mesh.len() {
            let code = codes.get(cell)?;
            if code == 0 {
                continue;
            }
            boundaries.push(cell);
            distance.set(cell, 0.0)?;
            kind.set(cell, code)?;
            if code == 2 {
                spreading.set(cell, 0.0)?;
                openings.push(cell);
            }
        }
        physical_distance(
            &self.mesh,
            boundaries,
            &mut distance,
            p.margin_influence_reach.max(1.0),
            |next, from| kind.set(next, kind.get(from)?),
        )?;
        physical_distance(&self.mesh, openings, &mut spreading, UNREACHABLE, |_, _| {
            Ok(())
        })?;
        let mut oldest: f64 = 0.0;
        for cell in 0..self.mesh.len() {
            let distance = spreading.get(cell)?;
            if distance != UNREACHABLE {
                oldest = oldest.max(distance);
            }
        }
        let scale = oldest.min(p.crust_age_saturation_distance).max(1.0);
        let increment = (context.tectonic_duration_myr * 1000.0 / OCEAN_MATURITY_MYR)
            .round()
            .max(1.0);
        self.assign_margins(&kind.read_only(), &spreading.read_only(), scale, increment)
    }
    fn assign_margins(
        &mut self,
        kind: &crate::storage::ReadBand<i32>,
        spreading: &crate::storage::ReadBand<f64>,
        scale: f64,
        increment: f64,
    ) -> io::Result<()> {
        let fraction = self.ground().view(GroundField::CrustContinentalFraction);
        for cell in 0..self.mesh.len() {
            let margin = match kind.get(cell)? {
                1 => 2,
                2 => 3,
                3 => 4,
                _ => {
                    if self.shared.code(C::CrustTypeCodes).get(cell)? == 2 {
                        1
                    } else {
                        0
                    }
                }
            };
            self.shared.code_mut(C::MarginCodes).set(cell, margin)?;
            let age = if !self.crust_formed {
                let d = spreading.get(cell)?;
                let share = if d == UNREACHABLE {
                    1.0
                } else {
                    (d / scale).clamp(0.0, 1.0)
                };
                (share.sqrt() * 1000.0).round()
            } else if self.shared.code(C::AdvectionSourceIndex).get(cell)? < 0 {
                0.0
            } else {
                let age = self.shared.scalar(S::CrustAge).get(cell)?;
                if fraction.get(cell)? < 500.0 {
                    (age + increment).min(1000.0)
                } else {
                    age
                }
            };
            self.shared.scalar_mut(S::CrustAge).set(cell, age)?;
        }
        Ok(())
    }
}
