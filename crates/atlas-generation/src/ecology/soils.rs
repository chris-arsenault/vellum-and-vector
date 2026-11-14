use super::{
    approach,
    environment::{environment, Environment},
    groups::{living_carbon, GROUPS},
    unit, Forcing, Habitat,
};
use crate::{
    field::shared::Scalar as S,
    rock::{
        ground::GroundField as G,
        organic::{self, Recycling},
    },
    scale::{LengthUnit, MapScale},
    water::{column::Store, soil},
};
use std::io;
pub fn erosion_history(map: &Habitat<'_>, cell: usize) -> io::Result<f64> {
    Ok(MapScale::metres(
        map.get(S::CumulativeFluvialErosion, cell)?
            + map.get(S::CumulativeGlacialErosion, cell)?
            + map.get(S::CumulativeCoastalErosion, cell)?,
        LengthUnit::Native,
    ))
}
pub fn geological_years(million_years: f64) -> f64 {
    million_years.max(0.0) * 1e6
}
pub fn balance_depth(erosion_rate: f64, production: f64, depth_scale: f64, deepest: f64) -> f64 {
    if production <= 0.0 {
        0.0
    } else if erosion_rate <= 0.0 {
        deepest
    } else {
        (depth_scale * (production / erosion_rate).ln())
            .min(deepest)
            .max(0.0)
    }
}
pub fn stripped(erosion: f64, production: f64, land_years: f64) -> f64 {
    (erosion - production.max(0.0) * land_years.max(0.0)).max(0.0)
}
pub fn evolve(
    map: &mut Habitat<'_>,
    years: f64,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    land_years: f64,
) -> io::Result<()> {
    let bare = map.length(2.5e-11)?;
    let depth = map.length(1.25e-7)?;
    for cell in 0..map.mesh.len() {
        let f = forcing(cell)?;
        let e = environment(map, cell, &f)?;
        organic::recycle(
            map.ground,
            map.fields,
            map.scale,
            Recycling {
                cell,
                area: map.mesh.area(cell),
                years,
                stillness: f.stillness,
            },
        )?;
        let production = bare * e.warmth * e.moisture * f.recovery;
        let worn = (erosion_history(map, cell)? - map.get(S::EcologyErosion, cell)?).max(0.0);
        let erosion = stripped(worn, production, land_years);
        damage(map, cell, years, &f, erosion)?;
        let weathering =
            (0.00015 + map.get(S::SoilCarbon, cell)? * 0.000005) * e.warmth * f.recovery;
        let room = map.length(3.75e-7)?.min(
            MapScale::metres(
                map.substrate(G::SedimentThickness, cell)?,
                LengthUnit::Native,
            ) + map.length(7.5e-8)?,
        );
        let settled = balance_depth(
            if land_years > 0.0 {
                worn / land_years
            } else {
                0.0
            },
            production,
            depth,
            room,
        );
        map.ground.soil_depth(
            cell,
            approach(
                map.substrate(G::SoilDepth, cell)?,
                settled + map.length(2.5e-7)? * f.verdure,
                years.max(land_years),
                1.0 / weathering.max(1e-8),
            ),
        )?;
        replenish(map, cell, years, &e, &f)?;
        taking(map, cell, &f)?;
        melt_release(map, cell)?;
        map.set(S::EcologyErosion, cell, erosion_history(map, cell)?)?;
        map.set(S::EcologyIce, cell, map.get(S::IceThickness, cell)?)?;
    }
    Ok(())
}
fn damage(
    map: &mut Habitat<'_>,
    cell: usize,
    years: f64,
    f: &Forcing,
    erosion: f64,
) -> io::Result<()> {
    let ice = (map.get(S::IceThickness, cell)? - map.get(S::EcologyIce, cell)?).max(0.0);
    let damage = 1.0 - (-erosion / map.length(5e-8)? - ice / map.length(1.25e-6)?).exp();
    let before = living_carbon(map, cell)?;
    for group in &GROUPS {
        map.set(
            group.cover,
            cell,
            map.get(group.cover, cell)? * (1.0 - damage),
        )?;
        if let Some(young) = group.juvenile {
            map.set(young, cell, map.get(young, cell)? * (1.0 - damage))?;
        }
        map.set(
            group.seed,
            cell,
            map.get(group.seed, cell)? * (1.0 - damage * 0.9),
        )?;
    }
    map.set(
        S::SoilCarbon,
        cell,
        map.get(S::SoilCarbon, cell)? * (1.0 - damage)
            + (before - living_carbon(map, cell)?).max(0.0),
    )?;
    map.ground.soil_depth(
        cell,
        (map.substrate(G::SoilDepth, cell)? - erosion).max(0.0) * (1.0 - damage * 0.8),
    )?;
    map.set(
        S::MineralNutrients,
        cell,
        map.get(S::MineralNutrients, cell)? * (1.0 - damage),
    )?;
    map.set(
        S::EcologicalDamage,
        cell,
        damage.max(map.get(S::EcologicalDamage, cell)? * (-years * f.recovery / 300.0).exp()),
    )
}
fn replenish(
    map: &mut Habitat<'_>,
    cell: usize,
    years: f64,
    e: &Environment,
    f: &Forcing,
) -> io::Result<()> {
    let fertility = 0.08 + map.get(S::SoilCarbon, cell)? / 80.0;
    let rate = e.warmth * f.recovery;
    if rate > 0.0 && map.get(S::MineralNutrients, cell)? < fertility {
        map.set(
            S::MineralNutrients,
            cell,
            approach(
                map.get(S::MineralNutrients, cell)?,
                fertility,
                years,
                300.0 / rate,
            ),
        )?;
    }
    Ok(())
}
fn melt_release(map: &mut Habitat<'_>, cell: usize) -> io::Result<()> {
    let release = (map.get(S::EcologyStillness, cell)? - map.get(S::Stillness, cell)?).max(0.0);
    if release > 0.0 {
        map.add(
            S::MineralNutrients,
            cell,
            release * (0.05 + map.get(S::SoilCarbon, cell)? * 0.004),
        )?;
        map.set(
            S::SoilCarbon,
            cell,
            map.get(S::SoilCarbon, cell)? * (1.0 - 0.3 * release),
        )?;
    }
    map.set(S::EcologyStillness, cell, map.get(S::Stillness, cell)?)
}
fn taking(map: &mut Habitat<'_>, cell: usize, f: &Forcing) -> io::Result<()> {
    let e = environment(map, cell, f)?;
    let roots = unit(
        map.get(S::TreeCover, cell)?
            + map.get(S::GrassCover, cell)? * 0.3
            + map.get(S::WetlandCover, cell)? * 0.4,
    );
    let capacity = soil::capacity(
        map.substrate(G::SoilDepth, cell)?,
        map.get(S::SoilCarbon, cell)?,
    );
    let rain = MapScale::metres(map.get(S::Rainfall, cell)?, LengthUnit::Millimetre);
    map.set(
        S::Infiltration,
        cell,
        unit(
            (0.2 + roots * 0.45
                + map.substrate(G::SoilDepth, cell)? * 600_000.0 / map.length(1.0)?)
                * (1.0 - 0.6 * f.salting),
        ),
    )?;
    let demand = (e.summer + 5.0).max(0.0) * map.length(3e-9)? * (0.2 + roots);
    map.set(
        S::Evapotranspiration,
        cell,
        rain.min(
            demand
                * unit(
                    map.water.column.store(Store::Soil).held(cell)?
                        / map.length(2.5e-9)?.max(capacity),
                ),
        ),
    )
}
