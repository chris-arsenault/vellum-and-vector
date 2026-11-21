use super::{
    approach, crossing,
    environment::environment,
    groups::Carrier,
    movement::{migrate, Migration},
    unit, Forcing, Habitat,
};
use crate::{
    field::shared::Scalar as S,
    storage::{Coverage, ReadBand},
};
use std::io;
pub fn population_response(value: f64, capacity: f64, years: f64, time: f64) -> f64 {
    if value <= 0.0 {
        0.0
    } else if capacity <= value {
        approach(value, capacity, years, 3.0)
    } else {
        capacity / (1.0 + (capacity / value - 1.0) * (-years / time).exp())
    }
}
fn forage(map: &Habitat<'_>, cell: usize, browser: bool) -> io::Result<f64> {
    let palatable =
        unit(1.0 - map.get(S::EcologicalToxicity, cell)? * 0.5 - map.get(S::Salting, cell)?);
    let food = if browser {
        map.get(S::TreeCover, cell)? * 0.018
    } else {
        map.get(S::GrassCover, cell)? * 0.08 + map.get(S::WetlandCover, cell)? * 0.025
    };
    Ok(food * map.get(S::Productivity, cell)? * palatable)
}
fn consume(
    map: &mut Habitat<'_>,
    population: S,
    capacity: &ReadBand<f64>,
    cell: usize,
    years: f64,
    browser: bool,
) -> io::Result<()> {
    let e = environment(map, cell, &Forcing::default())?;
    let danger = if e.frozen || e.submerged {
        1.0
    } else {
        map.get(S::EcologicalToxicity, cell)?
            .max(map.get(S::Salting, cell)?)
    };
    let predation = map.get(S::Predators, cell)? * 0.4;
    let target = capacity.get(cell)? / (1.0 + predation * 30.0) * (1.0 - danger);
    let before = map.get(population, cell)?;
    map.set(
        population,
        cell,
        population_response(before, target, years, 12.0),
    )?;
    let eating = eat_plants(
        map,
        cell,
        map.get(population, cell)? * 3.0 * -(-years).exp_m1(),
        browser,
    )?;
    map.add(
        S::SoilCarbon,
        cell,
        (before - map.get(population, cell)?).max(0.0) * 0.7 + eating * 0.3,
    )
}
fn eat_plants(map: &mut Habitat<'_>, cell: usize, demand: f64, browser: bool) -> io::Result<f64> {
    if !browser {
        let eaten = (map.get(S::GrassCover, cell)? * 0.9).min(demand);
        map.set(
            S::GrassCover,
            cell,
            (map.get(S::GrassCover, cell)? - eaten / 0.9).max(0.0),
        )?;
        return Ok(eaten);
    }
    let edible =
        map.get(S::BroadleafSaplings, cell)? * 2.0 + map.get(S::ConiferSaplings, cell)? * 1.6;
    let eaten = edible.min(demand);
    let fraction = eaten / edible.max(1e-9);
    for name in [S::BroadleafSaplings, S::ConiferSaplings] {
        map.set(name, cell, map.get(name, cell)? * (1.0 - fraction))?;
    }
    Ok(eaten)
}
fn found(
    map: &mut Habitat<'_>,
    population: S,
    capacity: &ReadBand<f64>,
    years: f64,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let reach = map.length(0.03)?;
    let landed = crossing::water_distance(
        map,
        |cell| Ok(map.get(population, cell)? > 1e-6),
        Carrier::Current,
        reach * 6.0,
        coverage,
    )?;
    for cell in 0..map.mesh.len() {
        if map.get(population, cell)? < 1e-7
            && capacity.get(cell)? > 0.0
            && crossing::crossing_time(50.0, reach, landed.get(cell)?) <= years
        {
            map.set(population, cell, capacity.get(cell)? * 0.01)?;
        }
    }
    Ok(())
}
pub fn evolve(
    map: &mut Habitat<'_>,
    years: f64,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let mut graze = coverage.scratch(map.mesh.len(), 0.0);
    let mut browse = coverage.scratch(map.mesh.len(), 0.0);
    let mut aquatic = coverage.scratch(map.mesh.len(), 0.0);
    for cell in 0..map.mesh.len() {
        graze.set(cell, forage(map, cell, false)? * forcing(cell)?.grazing)?;
        browse.set(cell, forage(map, cell, true)? * forcing(cell)?.grazing)?;
        aquatic.set(
            cell,
            map.get(S::AquaticProductivity, cell)?
                * 0.12
                * (1.0 - map.get(S::EcologicalToxicity, cell)?),
        )?;
    }
    let speed = forcing(0)?.migration;
    migrate(
        map,
        S::Grazers,
        &graze.read_only(),
        &Migration {
            years,
            speed: map.length(0.003)? * speed,
            aquatic: false,
        },
        coverage,
    )?;
    migrate(
        map,
        S::Browsers,
        &browse.read_only(),
        &Migration {
            years,
            speed: map.length(0.002)? * speed,
            aquatic: false,
        },
        coverage,
    )?;
    found(map, S::Grazers, &graze.read_only(), years, coverage)?;
    found(map, S::Browsers, &browse.read_only(), years, coverage)?;
    migrate(
        map,
        S::AquaticFauna,
        &aquatic.read_only(),
        &Migration {
            years,
            speed: map.length(0.005)? * speed,
            aquatic: true,
        },
        coverage,
    )?;
    for cell in 0..map.mesh.len() {
        consume(map, S::Grazers, &graze.read_only(), cell, years, false)?;
        consume(map, S::Browsers, &browse.read_only(), cell, years, true)?;
        // People's hunting takes game after it has grazed: the deeper the longer they hunt.
        let left = taken(forcing(cell)?.hunting, years, HUNTED_YEARS);
        for name in [S::Grazers, S::Browsers] {
            map.set(name, cell, map.get(name, cell)? * left)?;
        }
        map.set(
            S::Herbivores,
            cell,
            map.get(S::Grazers, cell)? + map.get(S::Browsers, cell)?,
        )?;
    }
    predators(map, years, speed, &aquatic.read_only(), coverage)?;
    // Fish regrow toward their water's carrying level with the predators; what people take
    // comes after, so the take is what the era leaves.
    fished(map, years, forcing)
}
/// How long full hunting takes to wear game down to a third, in years: the old society
/// cycle's `exp(−amount × years / 150)`.
const HUNTED_YEARS: f64 = 150.0;
/// Fishing wears the water's fauna more slowly than hunting wears game: open water refills
/// from beyond the shore.
const FISHED_YEARS: f64 = 600.0;
/// The share of a stock left after `years` of people taking it at `pressure` (0 to 1).
pub fn taken(pressure: f64, years: f64, wear_years: f64) -> f64 {
    (-pressure.clamp(0.0, 1.0) * years.max(0.0) / wear_years).exp()
}
/// People fish the water beside the shores they live on: each water cell loses fauna to the
/// heaviest fishing of the land touching it.
fn fished(
    map: &mut Habitat<'_>,
    years: f64,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        let fauna = map.get(S::AquaticFauna, cell)?;
        if fauna <= 0.0 {
            continue;
        }
        // A river's own people fish it too.
        let mut pressure = forcing(cell)?.fishing;
        for edge in 0..3 {
            if let Some(next) = map.mesh.neighbor(cell, edge) {
                pressure = pressure.max(forcing(next)?.fishing);
            }
        }
        if pressure > 0.0 {
            map.set(
                S::AquaticFauna,
                cell,
                fauna * taken(pressure, years, FISHED_YEARS),
            )?;
        }
    }
    Ok(())
}
fn predators(
    map: &mut Habitat<'_>,
    years: f64,
    speed: f64,
    aquatic: &ReadBand<f64>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let mut prey = coverage.scratch(map.mesh.len(), 0.0);
    for cell in 0..map.mesh.len() {
        prey.set(cell, map.get(S::Herbivores, cell)? * 0.08)?;
    }
    migrate(
        map,
        S::Predators,
        &prey.read_only(),
        &Migration {
            years,
            speed: map.length(0.0045)? * speed,
            aquatic: false,
        },
        coverage,
    )?;
    found(map, S::Predators, &prey.read_only(), years, coverage)?;
    for cell in 0..map.mesh.len() {
        let herbivores = map.get(S::Herbivores, cell)?;
        let predation = herbivores.min(map.get(S::Predators, cell)? * 2.0);
        let fraction = predation / herbivores.max(1e-9);
        for name in [S::Grazers, S::Browsers] {
            map.set(name, cell, map.get(name, cell)? * (1.0 - fraction))?;
        }
        map.set(
            S::Herbivores,
            cell,
            map.get(S::Grazers, cell)? + map.get(S::Browsers, cell)?,
        )?;
        map.set(
            S::Predators,
            cell,
            population_response(
                map.get(S::Predators, cell)?,
                prey.get(cell)? * (1.0 - map.get(S::EcologicalToxicity, cell)?),
                years,
                20.0,
            ),
        )?;
        map.set(
            S::AquaticFauna,
            cell,
            population_response(
                map.get(S::AquaticFauna, cell)?,
                aquatic.get(cell)?,
                years,
                5.0,
            ),
        )?;
    }
    Ok(())
}
