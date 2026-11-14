use super::Forcing;
use crate::{
    field::shared::{CellCode, Scalar as F},
    magic::{channels::Channel as C, sources::Environment, state::MagicField},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, Coverage},
    water::column::Store,
};
use std::io;
struct Moved {
    upwelling: Band<f64>,
    surface: Band<f64>,
    fog: Band<f64>,
    storm: Band<f64>,
}
fn shoals(env: &Environment<'_>, cell: usize) -> io::Result<bool> {
    let depth = env
        .scale
        .resolve(RelativeMeasure::new(0.0001, 1, 0.5, LengthUnit::Metre).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    if matches!(
        env.fields.code(CellCode::BathymetricZoneCodes).get(cell)?,
        2 | 3
    ) || env
        .water
        .column
        .store(Store::Standing)
        .contents()
        .get(cell)?
        < MapScale::native(depth)
    {
        return Ok(true);
    }
    for edge in 0..3 {
        if let Some(next) = env.mesh.neighbor(cell, edge) {
            if env.water.column.kind.get(next)? != 1 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn storm_energy(env: &Environment<'_>, field: &MagicField, cell: usize) -> io::Result<f64> {
    let anomaly = env.scalar(F::SeaSurfaceAnomaly, cell)?;
    let mut front: f64 = 0.0;
    for edge in 0..3 {
        if let Some(next) = env.mesh.neighbor(cell, edge) {
            front = front.max((anomaly - env.scalar(F::SeaSurfaceAnomaly, next)?).abs());
        }
    }
    let sharpness = (front / field.definition.parameters.storm_front_gradient).clamp(0.0, 1.0);
    let fed = 1.0 + (env.scalar(F::ExternalHeatForcing, cell)?.max(0.0) / 200.0).clamp(0.0, 1.0);
    Ok(1000.0 * field.definition.effects.storm * sharpness * fed)
}
fn move_at(
    env: &Environment<'_>,
    field: &MagicField,
    moved: &mut Moved,
    cell: usize,
    shoaling: bool,
) -> io::Result<()> {
    let e = &field.definition.effects;
    let intensity = field.channels.band(C::Intensity).get(cell)?;
    let lift = intensity - 160.0;
    let front = shoaling && lift > 0.0;
    let wake = field.channels.band(C::Wake).get(cell)? > 0.0 && intensity > 0.0;
    if front {
        moved
            .upwelling
            .set(cell, moved.upwelling.get(cell)? + lift * e.upwelling)?;
        moved
            .surface
            .set(cell, moved.surface.get(cell)? + lift * e.sea_surface)?;
        moved.fog.set(
            cell,
            moved
                .fog
                .get(cell)?
                .max((lift / 400.0).clamp(0.0, 1.0) * e.fog),
        )?;
    } else if wake {
        moved
            .surface
            .set(cell, moved.surface.get(cell)? + e.wake_warming)?;
    }
    if (front || wake) && e.storm > 0.0 {
        moved.storm.set(
            cell,
            moved.storm.get(cell)?.max(storm_energy(env, field, cell)?),
        )?;
    }
    Ok(())
}
fn nonzero(band: &Band<f64>) -> io::Result<bool> {
    for cell in 0..band.len() {
        if band.get(cell)? != 0.0 {
            return Ok(true);
        }
    }
    Ok(false)
}
pub fn feedback(
    env: &mut Environment<'_>,
    fields: &[MagicField],
    forcing: &mut Forcing,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let fields: Vec<_> = fields
        .iter()
        .filter(|field| {
            let e = &field.definition.effects;
            field.definition.enabled
                && [e.upwelling, e.sea_surface, e.wake_warming, e.fog, e.storm]
                    .iter()
                    .any(|v| *v != 0.0)
        })
        .collect();
    if fields.is_empty()
        && !nonzero(&forcing.upwelling)?
        && !nonzero(&forcing.sea_surface)?
        && !nonzero(&forcing.fog)?
    {
        return Ok(());
    }
    let count = env.mesh.len();
    let mut moved = Moved {
        upwelling: coverage.scratch(count, 0.0),
        surface: coverage.scratch(count, 0.0),
        fog: coverage.scratch(count, 0.0),
        storm: coverage.scratch(count, 0.0),
    };
    for cell in 0..count {
        if env.water.column.kind.get(cell)? != 1 {
            continue;
        }
        let shoaling = shoals(env, cell)?;
        for field in &fields {
            move_at(env, field, &mut moved, cell, shoaling)?;
        }
        moved.upwelling.set(
            cell,
            (moved.upwelling.get(cell)? + 0.5)
                .floor()
                .clamp(0.0, 1000.0),
        )?;
        moved
            .surface
            .set(cell, (moved.surface.get(cell)? + 0.5).floor())?;
        moved.storm.set(
            cell,
            (moved.storm.get(cell)? + 0.5).floor().clamp(0.0, 1000.0),
        )?;
    }
    let fog = settled_fog(env, &moved.fog, coverage)?;
    install(env, forcing, &moved, &fog)
}
fn settled_fog(
    env: &Environment<'_>,
    source: &Band<f64>,
    coverage: &mut Coverage,
) -> io::Result<Band<f64>> {
    let mut fog = coverage.scratch(env.mesh.len(), 0.0_f64);
    for cell in 0..env.mesh.len() {
        if env.water.column.kind.get(cell)? != 0 {
            continue;
        }
        for edge in 0..3 {
            if let Some(next) = env.mesh.neighbor(cell, edge) {
                fog.set(cell, fog.get(cell)?.max(source.get(next)?))?;
            }
        }
    }
    Ok(fog)
}
fn install(
    env: &mut Environment<'_>,
    forcing: &mut Forcing,
    moved: &Moved,
    fog: &Band<f64>,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        let upwelling = moved.upwelling.get(cell)?;
        let surface = moved.surface.get(cell)?;
        env.fields
            .scalar_mut(F::ExternalUpwelling)
            .set(cell, upwelling)?;
        env.fields
            .scalar_mut(F::ExternalSeaSurfaceForcing)
            .set(cell, surface)?;
        env.fields
            .scalar_mut(F::FogForcing)
            .set(cell, fog.get(cell)?)?;
        env.fields
            .scalar_mut(F::StormForcing)
            .set(cell, moved.storm.get(cell)?)?;
        if env.water.column.kind.get(cell)? == 1 {
            let mut band = env.fields.scalar_mut(F::Upwelling);
            band.set(
                cell,
                (band.get(cell)? + upwelling - forcing.upwelling.get(cell)? + 0.5)
                    .floor()
                    .clamp(0.0, 1000.0),
            )?;
            drop(band);
            let mut band = env.fields.scalar_mut(F::SeaSurfaceAnomaly);
            band.set(
                cell,
                (band.get(cell)? + surface - forcing.sea_surface.get(cell)? + 0.5).floor(),
            )?;
        }
        forcing.upwelling.set(cell, upwelling)?;
        forcing.sea_surface.set(cell, surface)?;
        forcing.fog.set(cell, fog.get(cell)?)?;
    }
    Ok(())
}
