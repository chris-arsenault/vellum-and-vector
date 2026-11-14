use super::failure;
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, Query, QueryDependency},
    field::{
        shared::{Flag, Scalar},
        Field,
    },
    processes::runner::PhysicalContext,
    rock::ground::GroundField,
    water::ocean::{FormationBudget, OceanInputs},
};
pub struct Budget {
    pub coverage: f64,
    pub sea_level: f64,
    pub elevation_scale: f64,
}
impl Field {
    pub fn ocean_budget(settings: Budget) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "ocean-budget",
            CommandKind::Initialize,
            vec![],
            move |scope, _| {
                let field: &mut Field = scope.state_mut();
                let ground = field.ground();
                let elevation = ground.view(GroundField::Elevation);
                let grounded_ice = field.shared.flag(Flag::GroundedIce);
                let ice_thickness = field.shared.scalar(Scalar::IceThickness);
                let formation = FormationBudget {
                    crust_forming: !field.crust_formed,
                    completed_epochs: ground.completed_epochs() as usize,
                    coverage: settings.coverage,
                    sea_level: settings.sea_level,
                    elevation_scale: settings.elevation_scale,
                };
                field
                    .water
                    .borrow_mut()
                    .initialize_ocean(
                        OceanInputs {
                            mesh: &field.mesh,
                            scale: &field.scale,
                            elevation: &elevation,
                            grounded_ice: &grounded_ice,
                            ice_thickness: &ice_thickness,
                        },
                        formation,
                        &mut field.coverage.borrow_mut(),
                    )
                    .map_err(failure)
            },
        )
    }
    pub fn ocean_surface(stand: Query<Self, AnswerBand>) -> Query<Self, ()> {
        // Sea stand reads the new datum after standing water has been cleared, as in water/ocean.ts.
        Query::new("ocean-surface", vec![], move |field: &Field, scope| {
            let c = scope.input::<PhysicalContext>()?;
            let elevation = field.ground().view(GroundField::Elevation);
            let grounded_ice = field.shared.flag(Flag::GroundedIce);
            let ice_thickness = field.shared.scalar(Scalar::IceThickness);
            let input = OceanInputs {
                mesh: &field.mesh,
                scale: &field.scale,
                elevation: &elevation,
                grounded_ice: &grounded_ice,
                ice_thickness: &ice_thickness,
            };
            let previous = field
                .water
                .borrow_mut()
                .prepare_ocean_surface(&input, c.sea_level_offset, &mut field.coverage.borrow_mut())
                .map_err(failure)?;
            field
                .ground
                .borrow_mut()
                .receive_sea_level(field.water().effective_sea_level);
            let stand = scope.get(&stand)?.values();
            field
                .water
                .borrow_mut()
                .finish_ocean_surface(&input, &stand, previous, &mut field.coverage.borrow_mut())
                .map_err(failure)
        })
    }
    pub fn marine_reconnection(
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "marine-reconnection",
            CommandKind::Event,
            dependencies,
            |scope, _| {
                scope
                    .state_mut()
                    .water
                    .borrow_mut()
                    .record_marine_connections()
                    .map_err(failure)
            },
        )
    }
}
