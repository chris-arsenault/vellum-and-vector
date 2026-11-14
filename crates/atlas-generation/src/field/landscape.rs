use super::{
    shared::{CellCode, Scalar},
    Field,
};
use crate::execution::{Command, CommandKind, ExecutionError};
use std::io;

impl Field {
    pub fn first_landscape() -> Command<Self, i32> {
        Command::with_inputs(
            "landscape-initialization",
            CommandKind::Initialize,
            vec![],
            |context, seed: &i32| {
                context
                    .state_mut()
                    .initialize_landscape(*seed)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    fn initialize_landscape(&mut self, seed: i32) -> io::Result<()> {
        let mut ground = self.ground.try_borrow_mut().map_err(io::Error::other)?;
        ground.reset_rock_strength()?;
        for cell in 0..self.mesh.len() {
            ground.reset_shares(cell)?;
            self.ground_load.clear(cell)?;
            self.sea_load.clear(cell)?;
        }
        for name in [
            Scalar::CumulativeFluvialErosion,
            Scalar::CumulativeGlacialErosion,
            Scalar::CumulativeGlacialDeposition,
            Scalar::CumulativeCoastalErosion,
            Scalar::MaximumIceThickness,
            Scalar::MaximumIceFlux,
            Scalar::WaveExposureHistory,
            Scalar::GeothermalHistory,
            Scalar::VolcanicActivity,
            Scalar::VolcanicConstructionHistory,
            Scalar::LandmarkMaintenance,
            Scalar::ExternalHeatForcing,
            Scalar::ExternalCoastalForcing,
            Scalar::ExternalCoastalForcingHistory,
        ] {
            let band = self.shared.scalar_mut(name);
            for cell in 0..self.mesh.len() {
                band.set(cell, 0.0)?;
            }
        }
        for cell in 0..self.mesh.len() {
            self.shared
                .code_mut(CellCode::VolcanicLastActiveEpoch)
                .set(cell, -1)?;
            let strain = self.shared.scalar(Scalar::TectonicStrain).get(cell)?;
            self.shared
                .scalar_mut(Scalar::TectonicActivityHistory)
                .set(cell, strain)?;
        }
        self.thrust_slip.clear();
        ground.reset_landscape_history()?;
        ground.initialize_rock(&self.shared.code(CellCode::CrustProvinceIds), seed)
    }
}
