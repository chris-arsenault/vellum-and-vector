use super::{
    crossing,
    environment::wind_strength,
    groups::{self, Group, Id, GROUPS},
    movement::{self, Front},
    Forcing, Habitat,
};
use crate::{
    field::shared::Scalar as S,
    noise,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage},
    water::column::Store,
};
use std::io;
pub fn initialize(
    map: &mut Habitat<'_>,
    initialized: &mut bool,
    seed: i32,
    inherited: bool,
) -> io::Result<()> {
    if *initialized {
        return Ok(());
    }
    for cell in 0..map.mesh.len() {
        inherit_groups(map, cell)?;
        let water = map.water.column.kind.get(cell)?;
        if !inherited && water != 1 {
            founders(map, cell, seed)?;
        }
        if !inherited
            && water > 0
            && map.water.column.store(Store::Standing).held(cell)? < map.length(0.00005)?
        {
            map.set(
                S::AquaticFauna,
                cell,
                map.get(S::AquaticFauna, cell)?.max(0.0001),
            )?;
        }
    }
    *initialized = true;
    Ok(())
}
fn inherit_groups(map: &mut Habitat<'_>, cell: usize) -> io::Result<()> {
    if map.get(S::BroadleafCover, cell)? + map.get(S::ConiferCover, cell)? == 0.0
        && map.get(S::TreeCover, cell)? > 0.0
    {
        map.set(S::BroadleafCover, cell, map.get(S::TreeCover, cell)?)?;
    }
    if map.get(S::Grazers, cell)? + map.get(S::Browsers, cell)? == 0.0 {
        map.set(S::Grazers, cell, map.get(S::Herbivores, cell)? * 0.6)?;
        map.set(S::Browsers, cell, map.get(S::Herbivores, cell)? * 0.4)?;
    }
    Ok(())
}
fn founders(map: &mut Habitat<'_>, cell: usize, seed: i32) -> io::Result<()> {
    let p = map.mesh.position(cell);
    let origin = map.mesh.origin();
    let diversity = (noise::world_noise(
        map.mesh,
        p[0] + origin[0],
        p[1] + origin[1],
        seed,
        map.length(0.0175)?,
        2,
    ) + 1.0)
        / 2.0;
    let floor = map.length(1.25e-7)?.min(
        MapScale::metres(
            map.substrate(G::SedimentThickness, cell)?,
            LengthUnit::Native,
        ) + map.length(3e-8)?,
    );
    map.ground
        .soil_depth(cell, map.substrate(G::SoilDepth, cell)?.max(floor))?;
    for (name, floor) in [
        (S::MineralNutrients, 0.08),
        (S::GrassSeed, 0.15),
        (S::BroadleafSeed, if diversity > 0.45 { 0.08 } else { 0.0 }),
        (S::ConiferSeed, if diversity < 0.55 { 0.08 } else { 0.0 }),
        (S::WetlandSeed, 0.02),
        (S::Grazers, diversity * 0.0002),
        (S::Browsers, (1.0 - diversity) * 0.0002),
        (S::Predators, 0.000001),
    ] {
        map.set(name, cell, map.get(name, cell)?.max(floor))?;
    }
    Ok(())
}
pub struct Arrival {
    pub group: &'static Group,
    pub front: Front,
    pub suitability: Band<f64>,
}
pub fn disperse(
    map: &Habitat<'_>,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    coverage: &mut Coverage,
) -> io::Result<Vec<Arrival>> {
    GROUPS
        .iter()
        .map(|group| arrival(map, group, forcing, coverage))
        .collect()
}
fn arrival(
    map: &Habitat<'_>,
    group: &'static Group,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    coverage: &mut Coverage,
) -> io::Result<Arrival> {
    let mut suitability = coverage.scratch(map.mesh.len(), 0.0);
    let mut starts = coverage.scratch(map.mesh.len(), f64::INFINITY);
    for cell in 0..map.mesh.len() {
        suitability.set(
            cell,
            groups::suitability(map, group, cell, &forcing(cell)?)?,
        )?;
        if map.get(group.seed, cell)? + map.get(group.cover, cell)? > 0.00001 {
            starts.set(cell, 0.0)?;
        }
    }
    let reach = map.length(group.reach)?;
    let landed = crossing::water_distance(
        map,
        |cell| Ok(starts.get(cell)? == 0.0),
        group.carrier,
        reach * 6.0,
        coverage,
    )?;
    for cell in 0..starts.len() {
        let distance = landed.get(cell)?;
        if distance.is_finite() {
            starts.set(
                cell,
                starts
                    .get(cell)?
                    .min(crossing::crossing_time(group.interval, reach, distance)),
            )?;
        }
    }
    let front = movement::front(
        map.mesh,
        &starts.read_only(),
        |cell| Ok(suitability.get(cell)? > 0.001),
        |cell, edge, other| seed_travel(map, group, &forcing(cell)?, cell, edge, other),
        coverage,
    )?;
    Ok(Arrival {
        group,
        front,
        suitability,
    })
}
fn seed_travel(
    map: &Habitat<'_>,
    group: &Group,
    f: &Forcing,
    cell: usize,
    edge: usize,
    other: usize,
) -> io::Result<f64> {
    let distance = map.mesh.edge_length(cell, edge);
    let p = map.mesh.position(cell);
    let q = map.mesh.position(other);
    let along = (map.mesh.delta_x(q[0] - p[0]) * map.get(S::WindX, cell)?
        + (q[1] - p[1]) * map.get(S::WindY, cell)?)
        / (distance * 1000.0)
        * wind_strength(map, cell)?;
    let waterborne =
        if group.id == Id::Wetland && map.water.routing.targets.get(cell)? == other as i32 {
            3.0
        } else {
            1.0
        };
    let speed = map.length(group.spread)?
        * f.migration
        * (1.0 + f.dispersal).max(0.0)
        * (1.0 + along * 0.6).max(0.2)
        * waterborne;
    Ok(if speed > 0.0 {
        distance * (1.0 + map.get(S::Slope, other)? * 10.0) / speed
    } else {
        f64::INFINITY
    })
}
