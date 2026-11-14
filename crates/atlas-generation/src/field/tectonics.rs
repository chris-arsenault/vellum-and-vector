use super::Field;
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    scale_settings::ResolvedSettings,
    spatial::SpatialKernel,
    tectonics::{initialization, province_settings, provinces, state::State},
};
use std::{io, rc::Rc};

impl Field {
    pub fn tectonics(&self) -> Option<&State> {
        self.tectonics.as_ref()
    }
    pub fn crust_forming(&self) -> bool {
        !self.crust_formed
    }
    pub fn province_layout(
        kernel: Rc<dyn SpatialKernel>,
        settings: &ResolvedSettings,
    ) -> io::Result<Command<Self, i32>> {
        let initialization = initialization::Settings::from_resolved(settings)?;
        let settings = province_settings::Settings::from_resolved(settings)?;
        Ok(Command::with_inputs(
            "tectonic-provinces",
            CommandKind::Initialize,
            vec![],
            move |context, seed: &i32| {
                let field: &mut Field = context.state_mut();
                if field.tectonics.is_none() {
                    let sites = initialization::initial_sites(
                        &field.mesh,
                        kernel.as_ref(),
                        &initialization,
                        *seed,
                    )
                    .map_err(ExecutionError::Failed)?;
                    field.tectonics = Some(
                        State::new(
                            &field.mesh,
                            kernel.as_ref(),
                            sites,
                            *seed,
                            settings.plate_drift_per_myr,
                        )
                        .map_err(ExecutionError::Failed)?,
                    );
                }
                let mut ground = field
                    .ground
                    .try_borrow_mut()
                    .map_err(|e| ExecutionError::Failed(e.to_string()))?;
                provinces::assign(
                    &mut provinces::Work {
                        mesh: &field.mesh,
                        state: field.tectonics.as_ref().unwrap(),
                        ground: &mut ground,
                        fields: &mut field.shared,
                        forming: !field.crust_formed,
                    },
                    &settings,
                    kernel.as_ref(),
                )
                .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        ))
    }
}
