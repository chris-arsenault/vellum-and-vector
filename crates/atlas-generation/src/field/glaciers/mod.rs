//! Land ice, its retained flow history, and the landforms it leaves.
mod deposition;
mod flow;
mod growth;
mod landforms;
mod settings;
pub mod surface;
use super::Field;
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query, QueryDependency},
    processes::runner::PhysicalContext,
};
pub use settings::{settings, Settings};
use std::{io, rc::Rc};
fn failure(error: io::Error) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
impl Field {
    pub fn land_ice(
        settings: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "land-ice",
            CommandKind::Work,
            dependencies,
            move |scope, context| {
                growth::run(scope.state_mut(), &settings, context).map_err(failure)
            },
        )
    }
    pub fn ice_flow(
        settings: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "ice-flow",
            CommandKind::Work,
            dependencies,
            move |scope, _| {
                flow::run(scope.state_mut(), &settings).map_err(failure)?;
                scope.state().check_ice_flow(&settings).map_err(failure)
            },
        )
    }
    pub fn glacial_deposition(
        settings: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Command<Self, PhysicalContext> {
        Self::material_command(
            "glacial-deposition",
            CommandKind::Work,
            dependencies,
            move |work, _, _| deposition::run(work, &settings),
        )
    }
    pub fn glacial_landforms(
        settings: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, crate::storage::ReadBand<i32>> {
        Query::new(
            "glacial-landforms",
            dependencies,
            move |field: &Field, _| {
                landforms::run(field, &settings).map_err(failure)?;
                Ok(field.shared.code(super::shared::CellCode::LandformCodes))
            },
        )
    }
}
