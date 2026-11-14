//! Whole-field material commands bind the existing owners without exposing writers to reads.
use super::{shared::SharedFields, Field};
use crate::{
    execution::{Command, CommandKind, ExecutionError, QueryDependency, QueryValues},
    lattice::TriangularLattice,
    rock::{ground::Ground, load::MaterialLoad},
    storage::Coverage,
    water::WaterView,
};
use std::io;

pub struct MaterialWork<'a> {
    pub ground: &'a mut Ground,
    pub load: &'a mut MaterialLoad,
    pub sea_load: &'a mut MaterialLoad,
    pub shared: &'a mut SharedFields,
    pub water: WaterView,
    pub mesh: &'a TriangularLattice,
    pub coverage: &'a mut Coverage,
}
impl Field {
    pub fn material_command<P: 'static>(
        id: &str,
        kind: CommandKind,
        dependencies: Vec<QueryDependency<Self>>,
        apply: impl Fn(&mut MaterialWork<'_>, &P, &QueryValues) -> io::Result<()> + 'static,
    ) -> Command<Self, P> {
        Command::with_inputs(id, kind, dependencies, move |context, input| {
            let (field, values) = context.parts();
            let water = field.water();
            let mut ground = field
                .ground
                .try_borrow_mut()
                .map_err(|error| ExecutionError::Failed(error.to_string()))?;
            apply(
                &mut MaterialWork {
                    ground: &mut ground,
                    load: &mut field.ground_load,
                    sea_load: &mut field.sea_load,
                    shared: &mut field.shared,
                    water,
                    mesh: &field.mesh,
                    coverage: field.coverage.get_mut(),
                },
                input,
                values,
            )
            .map_err(|error| ExecutionError::Failed(error.to_string()))
        })
    }
}
