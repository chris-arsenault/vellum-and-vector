use crate::{
    execution::{Command, CommandKind},
    field::Field,
    rock::ground::GroundField,
    spatial::SpatialKernel,
    water::{
        captured::{DrainageNetwork, RiverIdentity},
        inherit::RiverInheritance,
    },
};
use std::io;

pub struct Capture<'a> {
    pub epochs: usize,
    pub rivers: Option<&'a DrainageNetwork>,
    pub spatial: &'a dyn SpatialKernel,
    pub identity: &'a dyn Fn(&str) -> Option<RiverIdentity>,
}
pub fn initialize<'a>() -> Command<Field, Capture<'a>> {
    Command::with_inputs(
        "refinement.capture",
        CommandKind::Initialize,
        vec![],
        |scope, input: &Capture<'_>| {
            let field = scope.state_mut();
            field
                .ground
                .borrow_mut()
                .capture_completed_epochs(input.epochs);
            if let Some(rivers) = input.rivers {
                let heights = field.ground.borrow().view(GroundField::Elevation);
                field
                    .water
                    .borrow_mut()
                    .inherit_network(
                        rivers,
                        RiverInheritance {
                            mesh: &field.mesh,
                            spatial: input.spatial,
                            elevation: &|cell| heights.get(cell).map_err(|error| error.to_string()),
                        },
                        input.identity,
                    )
                    .map_err(io::Error::other)?;
            }
            Ok(())
        },
    )
}
