use super::{
    environment::{environment, wind_strength},
    groups::{self, Id, GROUPS},
    movement, unit, Forcing, Habitat,
};
use crate::{
    chance::Chance,
    field::shared::Scalar as S,
    scale::{LengthUnit, MapScale},
    storage::{Coverage, ReadBand},
};
use std::io;
pub fn flood(map: &mut Habitat<'_>, years: f64) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        let plain = map
            .get(S::FloodplainIntensity, cell)?
            .max(map.get(S::DeltaIntensity, cell)?)
            / 1000.0;
        let seasons = 0.3 + 0.7 * unit(map.get(S::Seasonality, cell)? / 15.0);
        let severity = if map.water.column.kind.get(cell)? == 0 {
            plain * seasons
        } else {
            0.0
        };
        map.set(S::FloodFrequency, cell, 0.5 * severity)?;
        if severity == 0.0 || years <= 0.0 {
            continue;
        }
        let flooded = severity * -(-years * map.get(S::FloodFrequency, cell)?).exp_m1();
        for group in &GROUPS {
            map.set(
                group.cover,
                cell,
                map.get(group.cover, cell)?
                    * (1.0 - flooded * (group.flood_sensitivity * 2.0).min(1.0)),
            )?;
            if let Some(young) = group.juvenile {
                map.set(young, cell, map.get(young, cell)? * (1.0 - flooded))?;
            }
            map.set(
                group.seed,
                cell,
                map.get(group.seed, cell)? * (1.0 - flooded * 0.5),
            )?;
        }
        map.add(S::MineralNutrients, cell, flooded * 0.02)?;
    }
    Ok(())
}
pub fn disturb(
    map: &mut Habitat<'_>,
    years: f64,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    seed: i32,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let mut fuel = coverage.scratch(map.mesh.len(), 0.0);
    let mut starts = coverage.scratch(map.mesh.len(), f64::INFINITY);
    for cell in 0..map.mesh.len() {
        fuel.set(cell, unit(groups::living_carbon(map, cell)? / 5.0))?;
        starts.set(
            cell,
            ignition(map, cell, fuel.get(cell)?, years, &forcing(cell)?, seed)?,
        )?;
    }
    let front = movement::front(
        map.mesh,
        &starts.read_only(),
        |cell| {
            Ok(fuel.get(cell)? > 0.015
                && map.water.column.kind.get(cell)? == 0
                && map.get(S::IceThickness, cell)? < map.length(2.5e-7)?)
        },
        |cell, edge, other| travel(map, &fuel.read_only(), cell, edge, other),
        coverage,
    )?;
    for cell in 0..map.mesh.len() {
        burn(map, cell, front.time.get(cell)?, years, &forcing(cell)?)?;
    }
    Ok(())
}
fn ignition(
    map: &Habitat<'_>,
    cell: usize,
    fuel: f64,
    years: f64,
    f: &Forcing,
    seed: i32,
) -> io::Result<f64> {
    let e = environment(map, cell, f)?;
    let p = map.mesh.position(cell);
    let origin = map.mesh.origin();
    let noise = (Chance::of(seed, 0)
        .noise(map.length(0.01125)?, 2)
        .across(map.mesh, [p[0] + origin[0], p[1] + origin[1]])
        + 1.0)
        / 2.0;
    let risk =
        -(-years * 0.0008 * e.drought.powi(2) * f.fire_regime * (1.0 + 3.0 * f.quickening) * fuel)
            .exp_m1();
    Ok(if f.fire > 0.0 || noise < risk * 0.3 {
        0.0
    } else {
        f64::INFINITY
    })
}
fn travel(
    map: &Habitat<'_>,
    fuel: &ReadBand<f64>,
    cell: usize,
    edge: usize,
    other: usize,
) -> io::Result<f64> {
    let distance = map.mesh.edge_length(cell, edge);
    let wetness = environment(map, other, &Forcing::default())?.wetness;
    let p = map.mesh.position(cell);
    let q = map.mesh.position(other);
    let wind = (map.mesh.delta_x(q[0] - p[0]) * map.get(S::WindX, cell)?
        + (q[1] - p[1]) * map.get(S::WindY, cell)?)
        / (distance * 1000.0)
        * wind_strength(map, cell)?;
    Ok(
        distance / (map.length(0.00375)? * fuel.get(other)?.max(0.1) * (1.0 + wind).max(0.1))
            * (1.0 + wetness * 20.0),
    )
}
fn burn(
    map: &mut Habitat<'_>,
    cell: usize,
    arrival: f64,
    years: f64,
    f: &Forcing,
) -> io::Result<()> {
    let e = environment(map, cell, f)?;
    let before = groups::living_carbon(map, cell)?;
    let spread = if arrival <= years {
        e.drought * 0.75
    } else {
        0.0
    };
    let construction = (MapScale::metres(
        map.get(S::VolcanicConstructionHistory, cell)? + map.get(S::ImpactExcavation, cell)?,
        LengthUnit::Native,
    ) - map.get(S::EcologyVolcanic, cell)?
        - map.get(S::EcologyImpact, cell)?)
    .max(0.0);
    let loss =
        unit(1.0 - (1.0 - f.fire.max(spread)) * (-construction / map.length(1.25e-6)?).exp());
    let fire = unit(f.fire.max(spread));
    map.set(S::FireActivity, cell, fire)?;
    for group in &GROUPS {
        let survival = if group.id == Id::Grass {
            1.0 - loss * 0.3
        } else {
            1.0 - loss
        };
        map.set(group.cover, cell, map.get(group.cover, cell)? * survival)?;
        if let Some(young) = group.juvenile {
            map.set(young, cell, map.get(young, cell)? * (1.0 - loss))?;
        }
        map.set(
            group.seed,
            cell,
            map.get(group.seed, cell)? * (1.0 - loss * 0.4),
        )?;
    }
    let lost = (before - groups::living_carbon(map, cell)?).max(0.0);
    map.add(S::SoilCarbon, cell, lost * (1.0 - fire * 0.85))?;
    map.add(S::MineralNutrients, cell, lost * fire * 0.01)?;
    map.set(
        S::CanopyAge,
        cell,
        map.get(S::CanopyAge, cell)? * (1.0 - loss),
    )?;
    map.set(
        S::EcologicalDamage,
        cell,
        map.get(S::EcologicalDamage, cell)?.max(loss),
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
    )
}
