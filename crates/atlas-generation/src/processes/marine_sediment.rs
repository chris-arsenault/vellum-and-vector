//! Dense sediment pulses follow connected seabed slopes and retain excess in closed depressions.
use crate::{
    execution::{Command, CommandKind},
    field::{material::MaterialWork, Field},
    hpc::{Direction, KeyedHeap},
    rock::{ground::GroundField, material::MaterialLayer},
    scale::{LengthUnit, MapScale},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    settlement::stage::{Deposit, Pool},
    storage::ReadBand,
};
use serde::Deserialize;
use std::io;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({
        "kind": "relative-settings", "values": {
            "MarineSettlingLength": {"kind":"relative-measure", "fraction":0.025, "dimension":1, "exponent":1},
            "MarineSuspensionGradient": 0.002
        }
    })).expect("Declared marine sediment settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    marine_settling_length: f64,
    marine_suspension_gradient: f64,
}

pub fn settled_share(distance: f64, gradient: f64, length: f64, reference: f64) -> f64 {
    -(-distance / (length * (1.0 + gradient / reference))).exp_m1()
}

fn downhill(
    work: &MaterialWork<'_>,
    bed: &ReadBand<f64>,
    cell: usize,
    edge: usize,
) -> io::Result<f64> {
    let Some(target) = work.mesh.neighbor(cell, edge) else {
        return Ok(0.0);
    };
    if work.water.column.kind.get(target)? != 1 {
        return Ok(0.0);
    }
    Ok(MapScale::metres(
        (bed.get(cell)? - bed.get(target)?).max(0.0),
        LengthUnit::Native,
    ) / work.mesh.edge_length(cell, edge))
}
fn settle(work: &mut MaterialWork<'_>, cell: usize, fraction: f64) -> io::Result<()> {
    let area = work.mesh.area(cell);
    let wanted = MapScale::in_units(
        work.sea_load.amount(cell)? * fraction / area,
        LengthUnit::Native,
    );
    let material = work.sea_load.get(cell)?;
    let actual = MapScale::metres(
        work.ground.deposit_pond(
            Deposit {
                cell,
                amount: wanted,
                cause: "sea-floor",
                material: &material,
            },
            work.water.effective_sea_level,
            Pool::Sea,
        )?,
        LengthUnit::Native,
    ) * area;
    work.sea_load.take(cell, actual)?;
    work.ground.settled_from_sea(actual);
    Ok(())
}
fn carry_cell(
    work: &mut MaterialWork<'_>,
    settings: &Settings,
    bed: &ReadBand<f64>,
    cell: usize,
) -> io::Result<()> {
    if work.sea_load.amount(cell)? <= 0.0 {
        return Ok(());
    }
    let (mut weight, mut distance, mut gradient) = (0.0, 0.0, 0.0);
    for edge in 0..3 {
        let slope = downhill(work, bed, cell, edge)?;
        weight += slope;
        distance += slope * work.mesh.edge_length(cell, edge);
        gradient += slope * slope;
    }
    let fraction = if weight > 0.0 {
        settled_share(
            distance / weight,
            gradient / weight,
            settings.marine_settling_length,
            settings.marine_suspension_gradient,
        )
    } else {
        1.0
    };
    settle(work, cell, fraction)?;
    if weight <= 0.0 {
        return Ok(());
    }
    let material = work.sea_load.take(cell, work.sea_load.amount(cell)?)?;
    for edge in 0..3 {
        let slope = downhill(work, bed, cell, edge)?;
        if slope > 0.0 {
            work.sea_load.add(
                work.mesh
                    .neighbor(cell, edge)
                    .expect("Positive marine slope has a neighbor"),
                &MaterialLayer {
                    depth: material.depth * slope / weight,
                    ..material.clone()
                },
            )?;
        }
    }
    Ok(())
}
fn execute(work: &mut MaterialWork<'_>, settings: &Settings) -> io::Result<()> {
    let mut has_marine_cargo = false;
    for cell in 0..work.mesh.len() {
        let amount = work.sea_load.amount(cell)?;
        if amount <= 0.0 {
            continue;
        }
        if work.water.column.kind.get(cell)? == 1 {
            has_marine_cargo = true;
        } else {
            work.load.add(cell, &work.sea_load.take(cell, amount)?)?;
        }
    }
    if !has_marine_cargo {
        return Ok(());
    }
    let mut bed = work.coverage.scratch(work.mesh.len(), 0.0);
    let mut queue = KeyedHeap::new([Direction::Descending], Direction::Ascending);
    let elevation = work.ground.view(GroundField::Elevation);
    for cell in 0..work.mesh.len() {
        let height = elevation.get(cell)?;
        bed.set(cell, height)?;
        if work.water.column.kind.get(cell)? == 1 {
            queue.push(u32::try_from(cell).map_err(io::Error::other)?, [height]);
        }
    }
    while let Some((cell, _)) = queue.pop() {
        carry_cell(work, settings, &bed.read_only(), cell as usize)?;
    }
    Ok(())
}
pub fn process(settings: &ResolvedSettings) -> io::Result<Command<Field>> {
    let settings: Settings = serde_json::from_value(settings.values().clone())?;
    Ok(Field::material_command(
        "marine-sedimentation",
        CommandKind::Work,
        vec![],
        move |work, _, _| execute(work, &settings),
    ))
}
