pub mod fallen;
pub mod geothermal;
pub mod greenwood;
pub mod ocean;
pub mod placed;
pub mod run;
pub mod salt;
use super::{channels::Channel, configuration::Source, parameters::Parameters, state::MagicField};
use crate::{
    field::{events::Event, magic::Channels, shared::Scalar},
    lattice::TriangularLattice,
    rock::ground::{Ground, GroundField},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    water::WaterView,
};
use std::io;
pub struct Environment<'a> {
    pub mesh: &'a TriangularLattice,
    pub scale: &'a MapScale,
    pub fields: Channels<'a>,
    pub ground: &'a mut Ground,
    pub water: &'a WaterView,
    pub events: &'a [Event],
}
impl Environment<'_> {
    pub fn scalar(&self, name: Scalar, cell: usize) -> io::Result<f64> {
        self.fields.scalar(name).get(cell)
    }
    pub fn land_without_ice(&self, cell: usize) -> io::Result<bool> {
        Ok(self.water.column.kind.get(cell)? == 0
            && self.scalar(Scalar::IceThickness, cell)? <= 0.0)
    }
}
#[derive(Clone, Copy)]
pub struct Context {
    pub origin: usize,
    pub epoch: i32,
    pub activity: f64,
}
impl MagicField {
    pub(super) fn origin_parameters(&self, index: usize) -> Parameters {
        self.definition
            .parameters
            .with_origin(&self.definition.origins[index].parameters)
    }
    pub(super) fn stock_index(&self, origin: usize, id: &str) -> Option<usize> {
        self.definition.origins[origin]
            .stocks
            .iter()
            .position(|stock| stock.id == id)
    }
}
pub fn site_strength(value: f64) -> f64 {
    let rounded = (value + 0.5).floor();
    if rounded < 50.0 {
        0.0
    } else {
        rounded.min(1000.0)
    }
}
pub fn propagation_activity(source: Source, activity: f64) -> f64 {
    if matches!(
        source,
        Source::Impact
            | Source::Forge
            | Source::Verdant
            | Source::Aquifer
            | Source::Death
            | Source::DeadLake
            | Source::Geothermal
            | Source::Strain
            | Source::Pairing
    ) {
        1.0
    } else {
        activity
    }
}
pub fn placed_strength(strength: f64, source: Source, activity: f64) -> f64 {
    if activity <= 0.0 {
        return 0.0;
    }
    let scale = if propagation_activity(source, activity) == 1.0 {
        activity
    } else {
        1.0
    };
    (strength * scale + 0.5).floor().clamp(0.0, 1000.0)
}
pub fn cold(
    environment: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
) -> io::Result<()> {
    let parameters = field.origin_parameters(context.origin);
    let elevation = environment.ground.view(GroundField::Elevation);
    let divisor = environment
        .scale
        .resolve(
            RelativeMeasure::new(0.0000025, 1, 0.5, LengthUnit::Metre).map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    for cell in 0..environment.mesh.len() {
        let strength = (parameters.base_input - environment.scalar(Scalar::Temperature, cell)?
            + MapScale::metres(elevation.get(cell)?, LengthUnit::Native).max(0.0) / divisor)
            .max(0.0);
        field
            .channels
            .band_mut(Channel::Source)
            .set(cell, strength)?;
    }
    Ok(())
}
pub fn pressure_at_depth(depth: f64, reference: f64) -> f64 {
    1000.0 * -(-depth.max(0.0) / reference).exp_m1()
}
