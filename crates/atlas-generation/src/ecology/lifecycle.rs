//! Process bodies; the dispatcher supplies current habitat reads before invoking them.
use super::{
    biomes, carbon,
    environment::{environment, Environment},
    establishment, groups,
    growth::{self, Restore},
    soils, unit, vegetation, Forcing, Habitat,
};
use crate::{
    field::shared::{CellCode, Scalar as S},
    lattice::Membership,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
    storage::{Coverage, ReadBand},
};
use std::io;
pub fn initialize(
    map: &mut Habitat<'_>,
    initialized: &mut bool,
    seed: i32,
    inherited: bool,
    restore: &Restore<'_>,
) -> io::Result<()> {
    establishment::initialize(map, initialized, seed, inherited)?;
    remember(map)?;
    restore_all(map, restore)
}
pub fn prepare_child(map: &mut Habitat<'_>, initialized: &mut bool, seed: i32) -> io::Result<()> {
    if *initialized {
        return Ok(());
    }
    establishment::initialize(map, initialized, seed, true)?;
    for cell in 0..map.mesh.len() {
        map.set(S::EcologyStillness, cell, map.get(S::Stillness, cell)?)?;
    }
    remember(map)
}
fn remember(map: &mut Habitat<'_>) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        map.set(
            S::EcologySediment,
            cell,
            MapScale::metres(
                map.substrate(G::SedimentThickness, cell)?,
                LengthUnit::Native,
            ),
        )?;
        map.set(
            S::EcologyVolcanic,
            cell,
            MapScale::metres(
                map.get(S::VolcanicConstructionHistory, cell)?,
                LengthUnit::Native,
            ),
        )?;
        map.set(
            S::EcologyImpact,
            cell,
            MapScale::metres(map.get(S::ImpactExcavation, cell)?, LengthUnit::Native),
        )?;
        map.set(S::EcologyErosion, cell, soils::erosion_history(map, cell)?)?;
        map.set(S::EcologyIce, cell, map.get(S::IceThickness, cell)?)?;
    }
    Ok(())
}
pub fn classify(map: &mut Habitat<'_>, content_only: bool) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        if content_only && map.mesh.membership(cell) != Membership::Content {
            continue;
        }
        let code = biomes::classify(map, cell, &environment(map, cell, &Forcing::default())?)?;
        map.fields
            .code_mut(CellCode::BiomeCodes)
            .set(cell, code as i32)?;
    }
    Ok(())
}
pub fn present(
    map: &mut Habitat<'_>,
    initialized: &mut bool,
    seed: i32,
    restore: &Restore<'_>,
) -> io::Result<()> {
    establishment::initialize(map, initialized, seed, true)?;
    for cell in 0..map.mesh.len() {
        let stress = present_stress(&environment(map, cell, &Forcing::default())?);
        if stress > 0.0 {
            mortality(map, cell, stress, restore)?;
        }
        growth::normalize(map, cell)?;
        growth::update_tree_cover(map, cell)?;
    }
    restore_all(map, restore)?;
    classify(map, false)
}
fn present_stress(e: &Environment) -> f64 {
    if e.frozen || e.submerged {
        1.0
    } else {
        unit((e.temperature - 50.0) / 15.0)
    }
}
fn mortality(
    map: &mut Habitat<'_>,
    cell: usize,
    stress: f64,
    restore: &Restore<'_>,
) -> io::Result<()> {
    let previous = groups::living_carbon(map, cell)?;
    let survival = 1.0 - stress;
    for group in &groups::GROUPS {
        map.set(group.cover, cell, map.get(group.cover, cell)? * survival)?;
        if let Some(young) = group.juvenile {
            map.set(young, cell, map.get(young, cell)? * survival)?;
        }
    }
    growth::update_tree_cover(map, cell)?;
    restore(map, cell)?;
    map.add(
        S::SoilCarbon,
        cell,
        (previous - groups::living_carbon(map, cell)?).max(0.0),
    )?;
    for name in [
        S::Productivity,
        S::Herbivores,
        S::Predators,
        S::Grazers,
        S::Browsers,
    ] {
        map.set(name, cell, map.get(name, cell)? * survival)?;
    }
    Ok(())
}
fn restore_all(map: &mut Habitat<'_>, restore: &Restore<'_>) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        restore(map, cell)?;
    }
    Ok(())
}
pub struct Advance {
    pub years: f64,
    pub inherited: bool,
    pub new_human_time: bool,
    pub land_million_years: f64,
    pub seed: i32,
    pub epoch_index: i32,
}
pub fn advance(
    map: &mut Habitat<'_>,
    initialized: &mut bool,
    input: &Advance,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    restore: &Restore<'_>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    if input.inherited && !input.new_human_time {
        return Ok(());
    }
    restore_all(map, restore)?;
    vegetation::respond(
        map,
        initialized,
        &vegetation::Response {
            years: input.years,
            land_years: if input.new_human_time {
                input.years
            } else {
                input
                    .years
                    .max(soils::geological_years(input.land_million_years))
            },
            seed: input.seed ^ (input.epoch_index.wrapping_add(1).wrapping_mul(16_777_619)),
            advance_age: true,
        },
        forcing,
        restore,
        coverage,
    )?;
    restore_all(map, restore)?;
    carbon::accumulate(map, input.years, forcing)
}
pub struct Development {
    pub exposure: f64,
    pub land_million_years: f64,
    pub land_share: f64,
    pub seed: i32,
    pub round: i32,
}
pub fn develop(
    map: &mut Habitat<'_>,
    initialized: &mut bool,
    input: &Development,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    restore: &Restore<'_>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    if input.exposure <= 0.0 {
        return Ok(());
    }
    vegetation::respond(
        map,
        initialized,
        &vegetation::Response {
            years: input.exposure,
            land_years: soils::geological_years(input.land_million_years) * input.land_share,
            seed: input.seed ^ input.round,
            advance_age: false,
        },
        forcing,
        restore,
        coverage,
    )?;
    carbon::accumulate(map, input.exposure, forcing)?;
    carbon::bury(map)
}
#[derive(Clone)]
pub struct Fixed {
    pub name: S,
    pub values: ReadBand<f64>,
}
/// Existing authored cover remains input authority; this does not introduce editing tools.
#[derive(Clone)]
pub struct Authority {
    pub woodland: ReadBand<u8>,
    pub fixed: Vec<Fixed>,
    pub regional: bool,
}
impl Authority {
    pub fn restore(&self, map: &mut Habitat<'_>, cell: usize) -> io::Result<()> {
        let woodland = self.woodland.get(cell)? != 0;
        if woodland && !self.regional {
            map.set(S::TreeCover, cell, map.get(S::TreeCover, cell)?.max(0.7))?;
            map.set(S::GrassCover, cell, map.get(S::GrassCover, cell)?.min(0.2))?;
            map.set(
                S::WetlandCover,
                cell,
                map.get(S::WetlandCover, cell)?.min(0.1),
            )?;
        }
        let fixed_tree = self.apply_fixed(map, cell)?;
        if self.regional && woodland {
            growth::authoritative_canopy(map, cell, map.get(S::TreeCover, cell)?.max(0.7))
        } else if !self.regional && (woodland || fixed_tree) {
            growth::authoritative_canopy(map, cell, map.get(S::TreeCover, cell)?)
        } else {
            growth::update_tree_cover(map, cell)
        }
    }
    fn apply_fixed(&self, map: &mut Habitat<'_>, cell: usize) -> io::Result<bool> {
        let mut tree = false;
        for fixed in &self.fixed {
            let value = fixed.values.get(cell)?;
            if value.is_finite() {
                map.set(fixed.name, cell, value)?;
                tree |= fixed.name == S::TreeCover;
            }
        }
        Ok(tree)
    }
}
