use super::{
    animals, biomes, disturbance,
    environment::environment,
    establishment, forcing,
    growth::{self, Restore},
    soils, Forcing, Habitat,
};
use crate::{field::shared::CellCode, storage::Coverage};
use std::io;
pub struct Response {
    pub years: f64,
    pub land_years: f64,
    pub seed: i32,
    pub advance_age: bool,
}
pub fn respond(
    map: &mut Habitat<'_>,
    initialized: &mut bool,
    input: &Response,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    restore: &Restore<'_>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    establishment::initialize(map, initialized, input.seed, false)?;
    if input.years > 0.0 {
        soils::evolve(map, input.years, forcing, input.land_years)?;
        forcing::toxicity(map, input.years, forcing)?;
        disturbance::disturb(map, input.years, forcing, input.seed, coverage)?;
        disturbance::flood(map, input.years)?;
        let arrivals = establishment::disperse(map, forcing, coverage)?;
        growth::grow(
            map,
            input.years,
            &arrivals,
            forcing,
            restore,
            input.advance_age,
        )?;
        animals::evolve(map, input.years, forcing, coverage)?;
    }
    for cell in 0..map.mesh.len() {
        growth::normalize(map, cell)?;
        growth::update_tree_cover(map, cell)?;
        restore(map, cell)?;
        let biome = biomes::classify(map, cell, &environment(map, cell, &Forcing::default())?)?;
        map.fields
            .code_mut(CellCode::BiomeCodes)
            .set(cell, biome as i32)?;
    }
    Ok(())
}
