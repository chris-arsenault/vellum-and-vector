//! Transported organic carbon remains cargo in the material that carries it.
use super::ground::{inventory::InventoryKey, Ground, GroundField};
use crate::{
    field::shared::{Scalar, SharedFields},
    scale::{MapScale, RelativeMeasure},
};
use std::io;
pub const DENSITY: f64 = 150.0;
pub fn cargo_key(ground: &mut Ground) -> io::Result<InventoryKey> {
    ground.inventory("organic:carbon", None)
}
pub struct Recycling {
    pub cell: usize,
    pub area: f64,
    pub years: f64,
    pub stillness: f64,
}
pub fn recycle(
    ground: &mut Ground,
    fields: &mut SharedFields,
    scale: &MapScale,
    input: Recycling,
) -> io::Result<()> {
    let key = cargo_key(ground)?;
    let fraction = -(-input.years * (1.0 - 0.9 * input.stillness) / 300.0).exp_m1();
    let reach = scale
        .resolve(RelativeMeasure::length(2.5e-8).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let reach = MapScale::native(ground.view(GroundField::SoilDepth).get(input.cell)? + reach);
    let carbon = ground.inventory_release(key, input.cell, reach, &|_| fraction)? / input.area;
    for (field, amount) in [
        (Scalar::SoilCarbon, carbon),
        (Scalar::MineralNutrients, carbon * 0.02),
    ] {
        let values = fields.scalar_mut(field);
        values.set(input.cell, values.get(input.cell)? + amount)?;
    }
    Ok(())
}
