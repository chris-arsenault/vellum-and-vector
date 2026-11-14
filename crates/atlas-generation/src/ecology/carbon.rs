use super::{environment::environment, unit, Forcing, Habitat};
use crate::{
    field::shared::Scalar as S,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
};
use std::io;
pub fn pool(stock: f64, input: f64, loss: f64, years: f64) -> f64 {
    stock * (-loss * years).exp() + input * -(-loss * years).exp_m1() / loss
}
pub fn accumulate(
    map: &mut Habitat<'_>,
    years: f64,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        let e = environment(map, cell, &Forcing::default())?;
        let f = forcing(cell)?;
        let preservation = (-f.preservation).exp();
        let temperature = ((e.temperature - 15.0) / 25.0).exp();
        let wet = if e.submerged { 1.0 } else { e.wetness };
        let pace = (1.0 + 3.0 * f.quickening) * (1.0 - 0.9 * f.stillness);
        let decay = (0.03 * (1.0 - wet) + 0.0003 * wet) * temperature * preservation * pace;
        let litter =
            map.get(S::Productivity, cell)? * (1.0 - map.get(S::FireActivity, cell)? * 0.8);
        map.set(
            S::SoilCarbon,
            cell,
            pool(
                map.get(S::SoilCarbon, cell)?,
                litter * (1.0 - wet),
                decay,
                years,
            ),
        )?;
        map.set(
            S::PeatCarbon,
            cell,
            pool(map.get(S::PeatCarbon, cell)?, litter * wet, decay, years),
        )?;
        let aquatic = if e.water != 0 || wet > 0.5 {
            0.0005
        } else {
            0.04
        };
        map.set(
            S::AquaticCarbon,
            cell,
            pool(
                map.get(S::AquaticCarbon, cell)?,
                map.get(S::AquaticProductivity, cell)? * 0.3,
                aquatic * temperature * preservation,
                years,
            ),
        )?;
    }
    Ok(())
}
const BURIED: [S; 5] = [
    S::BuriedPlantCarbon,
    S::BuriedAquaticCarbon,
    S::CoalCarbon,
    S::OilCarbon,
    S::GasCarbon,
];
fn burial(map: &mut Habitat<'_>, cell: usize) -> io::Result<()> {
    let sediment = MapScale::metres(
        map.substrate(G::SedimentThickness, cell)?,
        LengthUnit::Native,
    );
    let delta = sediment - map.get(S::EcologySediment, cell)?;
    let mut existing = 0.0;
    for name in BURIED {
        existing += map.get(name, cell)?;
    }
    let old_depth = map.get(S::OrganicBurialDepth, cell)?;
    let depth = (old_depth + delta).max(0.0);
    let exposed = if delta < 0.0 {
        unit((-delta - old_depth) / map.length(2.5e-7)?.max(-delta))
    } else {
        0.0
    };
    for name in BURIED {
        map.set(name, cell, map.get(name, cell)? * (1.0 - exposed))?;
    }
    let fraction = -(-delta.max(0.0) / map.length(5e-7)?).exp_m1();
    let plant = (map.get(S::SoilCarbon, cell)? + map.get(S::PeatCarbon, cell)?) * fraction;
    let aquatic = map.get(S::AquaticCarbon, cell)? * fraction;
    for name in [S::SoilCarbon, S::PeatCarbon, S::AquaticCarbon] {
        map.set(name, cell, map.get(name, cell)? * (1.0 - fraction))?;
    }
    map.add(S::BuriedPlantCarbon, cell, plant)?;
    map.add(S::OrganicBurialInput, cell, plant)?;
    map.add(S::OrganicBurialThickness, cell, delta.max(0.0))?;
    map.add(S::BuriedAquaticCarbon, cell, aquatic)?;
    let retained = existing * (1.0 - exposed);
    let total = retained + plant + aquatic;
    map.set(
        S::OrganicBurialDepth,
        cell,
        if total > 0.0 {
            (retained * depth + (plant + aquatic) * delta.max(0.0) / 2.0) / total
        } else {
            0.0
        },
    )?;
    map.set(
        S::OrganicMaturity,
        cell,
        map.get(S::OrganicMaturity, cell)? * if total > 0.0 { retained / total } else { 0.0 },
    )?;
    map.set(S::EcologySediment, cell, sediment)
}
fn mature(map: &mut Habitat<'_>, cell: usize, years: f64) -> io::Result<()> {
    let depth = map.get(S::OrganicBurialDepth, cell)?;
    let gradient = (100_000.0 + (map.get(S::Geothermal, cell)? / 1000.0).max(0.0) * 160_000.0)
        / map.length(1.0)?;
    let temperature = map.get(S::Temperature, cell)? / 10.0 - 30.0 + depth * gradient;
    if depth < map.length(2.5e-6)? || years == 0.0 {
        return Ok(());
    }
    let dose = years / 1_000_000.0 * ((temperature - 100.0) / 18.0).exp();
    map.add(S::OrganicMaturity, cell, dose)?;
    let conversion = if temperature >= 60.0 {
        -(-dose / 4.0).exp_m1()
    } else {
        0.0
    };
    let plant = map.get(S::BuriedPlantCarbon, cell)? * conversion;
    let aquatic = map.get(S::BuriedAquaticCarbon, cell)? * conversion;
    map.add(S::BuriedPlantCarbon, cell, -plant)?;
    map.add(S::BuriedAquaticCarbon, cell, -aquatic)?;
    map.add(S::CoalCarbon, cell, plant * 0.65)?;
    map.add(S::OilCarbon, cell, aquatic * 0.7 + plant * 0.05)?;
    map.add(S::GasCarbon, cell, aquatic * 0.3 + plant * 0.3)?;
    let cracked = if temperature > 150.0 {
        -(-dose / 12.0).exp_m1()
    } else {
        0.0
    };
    let oil = map.get(S::OilCarbon, cell)? * cracked;
    let coal = map.get(S::CoalCarbon, cell)? * cracked * 0.3;
    map.add(S::OilCarbon, cell, -oil)?;
    map.add(S::CoalCarbon, cell, -coal)?;
    map.add(S::GasCarbon, cell, oil + coal)
}
pub fn bury(map: &mut Habitat<'_>) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        burial(map, cell)?;
    }
    Ok(())
}
pub fn evolve(map: &mut Habitat<'_>, years: f64) -> io::Result<()> {
    bury(map)?;
    for cell in 0..map.mesh.len() {
        mature(map, cell, years)?;
    }
    Ok(())
}
