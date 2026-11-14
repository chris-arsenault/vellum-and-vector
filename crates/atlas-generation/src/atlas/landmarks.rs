//! Epoch callers for the existing siting, emplacement and maintenance owners.
use super::{context::Epoch, parameters::AtlasParameters, state::State};
use crate::{
    execution::{Command, CommandKind, Projection},
    field::{landmarks::lifecycle, Field},
    spatial::SpatialKernel,
};
use std::rc::Rc;

pub struct Inputs {
    pub seed: i32,
    pub epochs: Vec<Epoch>,
    pub parameters: AtlasParameters,
    pub tectonic_history: bool,
    pub has_parent: bool,
}
pub struct Operations {
    pub emplace: Command<State, usize>,
    pub maintain: Command<State, usize>,
}
impl Operations {
    pub fn new(
        inputs: Rc<Inputs>,
        owner: Rc<lifecycle::Operations>,
        spatial: Rc<dyn SpatialKernel>,
        projection: &Projection<State, Field>,
    ) -> Self {
        let emplace = owner
            .clone()
            .emplacement(spatial.clone())
            .projected(projection);
        let maintain = owner.maintenance(spatial).projected(projection);
        let emplacement_input = inputs.clone();
        Self {
            emplace: Command::with_inputs(
                "landmark.emplace",
                CommandKind::Event,
                vec![],
                move |scope, epoch| {
                    let sited = scope
                        .state_mut()
                        .site_landmarks(&emplacement_input, *epoch)?;
                    let work = scope
                        .state()
                        .landmark_work(&emplacement_input, *epoch, false)?;
                    for item in work {
                        scope.run(&emplace, &item)?;
                        scope.state_mut().record_landmark_cause(
                            &item.landmark,
                            false,
                            0.0,
                            sited.contains(&item.landmark.id),
                        );
                    }
                    Ok(())
                },
            ),
            maintain: Command::with_inputs(
                "landmark.maintain",
                CommandKind::Event,
                vec![],
                move |scope, epoch| {
                    let work = scope.state().landmark_work(&inputs, *epoch, true)?;
                    for item in work {
                        let before = scope
                            .state()
                            .field()
                            .landmark_ledger()
                            .iter()
                            .find(|record| record.id == item.landmark.id)
                            .map_or(0.0, |record| record.maintenance);
                        scope.run(&maintain, &item)?;
                        scope.state_mut().record_landmark_cause(
                            &item.landmark,
                            true,
                            before,
                            false,
                        );
                    }
                    Ok(())
                },
            ),
        }
    }
}
