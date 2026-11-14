mod air;
mod atmosphere;
pub mod currents;
pub mod regional;
mod responders;
pub mod settings;
mod thermal;
mod wind;
mod wrap;
use super::{shared::Scalar, Field};
use crate::{
    execution::{ExecutionError, Query, QueryDependency},
    processes::runner::PhysicalContext,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
pub use responders::respond;
use settings::Settings;
use std::{io, rc::Rc};

fn read(field: &Field, name: Scalar, cell: usize) -> io::Result<f64> {
    field.shared.scalar(name).get(cell)
}
fn write(field: &Field, name: Scalar, cell: usize, value: f64) -> io::Result<()> {
    field.shared.derive_scalar(name).set(cell, value)
}
fn ocean(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(field.water().column.kind.get(cell)? == 1)
}
fn height(field: &Field, cell: usize) -> io::Result<f64> {
    if ocean(field, cell)? {
        return Ok(0.0);
    }
    let ground = field.ground();
    Ok(MapScale::metres(
        ground.view(GroundField::Elevation).get(cell)? - ground.effective_sea_level(),
        LengthUnit::Native,
    )
    .round()
    .max(0.0))
}
fn latitude(field: &Field, p: &Settings, cell: usize) -> f64 {
    p.latitude()
        .latitude_at_y(field.mesh.position(cell)[1] + field.mesh.origin()[1])
}
impl Field {
    pub fn atmospheric_climate(
        settings: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "atmospheric-climate",
            dependencies,
            move |field: &Field, scope| {
                let context = scope.input::<PhysicalContext>()?;
                let run = || -> io::Result<()> {
                    thermal::temperature(field, &settings, &context)?;
                    atmosphere::flow(field, &settings, &context)?;
                    air::moisture(field, &settings)?;
                    thermal::precipitation(field, &settings, &context)
                };
                run().map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
}
