//! Distinct systems alter finite retained strata through Ground's existing material operations.
use super::{
    channels::Channel as C,
    leakage,
    sources::{geothermal::mineralize, Environment},
    state::MagicField,
};
use crate::{
    field::shared::Scalar as F,
    noise::fractal_noise,
    rock::{
        catalogue::{self, material},
        ground::alteration::Alteration,
        load::MaterialLoad,
        ModeId, ModeMix,
    },
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::{
        removal::Facet,
        stage::{Pool, SurfaceAction},
    },
};
use std::io;
fn length(env: &Environment<'_>, fraction: f64) -> io::Result<f64> {
    Ok(env
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
fn unwarded(env: &Environment<'_>, cell: usize) -> io::Result<f64> {
    Ok(1.0 - env.scalar(F::Warding, cell)?.clamp(0.0, 1.0))
}
pub fn body_rank(x: f64, y: f64, salt: i32, width: f64) -> f64 {
    1.0 / (1.0 + (-fractal_noise(x, y, salt, width, 2) / 0.2).exp())
}
fn in_body(env: &Environment<'_>, cell: usize, share: f64, salt: i32) -> io::Result<bool> {
    let [x, y] = env.mesh.position(cell);
    let [ox, oy] = env.mesh.origin();
    Ok(body_rank(ox + x, oy + y, salt, length(env, 0.06)?) < share)
}
fn system_salt(field: &MagicField, seed: i32) -> i32 {
    let mut units = field.definition.id.encode_utf16();
    let first = i32::from(units.next().unwrap_or(0));
    seed ^ 0x7e20 ^ (field.definition.id.encode_utf16().count() as i32) ^ (first << 8)
}
fn reaches(env: &Environment<'_>, field: &MagicField, cell: usize, seed: i32) -> io::Result<bool> {
    in_body(
        env,
        cell,
        field.system_coverage.get(cell)?,
        system_salt(field, seed),
    )
}
fn alter(
    env: &mut Environment<'_>,
    cell: usize,
    kind: usize,
    depth: f64,
    from_rock: bool,
    offset: f64,
) -> io::Result<()> {
    let epoch = env.ground.completed_epochs();
    env.ground.alter(
        cell,
        &Alteration {
            depth,
            offset,
            from_rock,
            retained_only: false,
            facet: None,
            transform: &|layer| mineralize(layer, kind, epoch),
        },
    )
}
fn add_rock(env: &mut Environment<'_>, cell: usize, kind: usize, fraction: f64) -> io::Result<()> {
    let depth = MapScale::native(length(env, fraction)?);
    if depth > 0.0 {
        env.ground.construct_material(
            cell,
            &material(kind, depth, env.ground.completed_epochs()),
            "magic rock",
            Pool::Space,
            None,
        )?;
    }
    Ok(())
}
pub fn seal_conduit(env: &mut Environment<'_>, cell: usize) -> io::Result<()> {
    add_rock(env, cell, 15, 0.00003 * unwarded(env, cell)?)
}
fn fire(
    env: &mut Environment<'_>,
    field: &MagicField,
    cell: usize,
    seed: i32,
    span: f64,
) -> io::Result<()> {
    if !reaches(env, field, cell, seed)? {
        return Ok(());
    }
    let heat = field.channels.band(C::Intensity).get(cell)?;
    if heat >= 450.0 && env.scalar(F::FractureConductance, cell)? > 0.0 {
        let depth = MapScale::native(length(
            env,
            0.00015 * span * heat / 1000.0
                * unwarded(env, cell)?
                * field.definition.effects.rock_resistance.max(0.0)
                / 900.0,
        )?);
        let offset = if heat >= 750.0 {
            0.0
        } else {
            MapScale::native(length(env, 0.00002)?)
        };
        alter(env, cell, 14, depth, true, offset)?;
    }
    Ok(())
}
fn aurora(env: &mut Environment<'_>, field: &MagicField, cell: usize, seed: i32) -> io::Result<()> {
    let charge = field.channels.band(C::Stored).get(cell)?;
    let iced = env.scalar(F::IceThickness, cell)? > 0.0;
    if iced && field.channels.band(C::Source).get(cell)?.max(charge) >= 350.0 {
        let depth = MapScale::native(length(env, 0.0000375 * unwarded(env, cell)?)?);
        alter(env, cell, 18, depth, false, 0.0)?;
    }
    if iced || charge < 250.0 || env.water.column.kind.get(cell)? != 0 {
        return Ok(());
    }
    if in_body(
        env,
        cell,
        charge / 1000.0 * 0.25,
        system_salt(field, seed) ^ 0x7e13,
    )? {
        let depth = MapScale::native(length(
            env,
            0.000065 * charge * unwarded(env, cell)? / 1000.0
                * (-field.definition.effects.rock_resistance).max(0.0)
                / 520.0,
        )?);
        alter(env, cell, 17, depth, false, 0.0)?;
    }
    Ok(())
}
fn pressure_at_rock(env: &Environment<'_>, field: &MagicField, cell: usize) -> io::Result<f64> {
    if env.water.column.kind.get(cell)? != 0 {
        return field.channels.band(C::Intensity).get(cell);
    }
    let mut force: f64 = 0.0;
    for edge in 0..3 {
        if let Some(next) = env.mesh.neighbor(cell, edge) {
            if env.water.column.kind.get(next)? == 1 {
                force = force.max(field.channels.band(C::Intensity).get(next)?);
            }
        }
    }
    Ok(force * field.definition.effects.coastal_forcing)
}
fn pressure(
    env: &mut Environment<'_>,
    field: &MagicField,
    cell: usize,
    seed: i32,
) -> io::Result<()> {
    let force = pressure_at_rock(env, field, cell)?;
    if force < 300.0 || (env.water.column.kind.get(cell)? != 0 && !reaches(env, field, cell, seed)?)
    {
        return Ok(());
    }
    let depth = MapScale::native(length(
        env,
        0.000045 * force * unwarded(env, cell)? / 1000.0,
    )?);
    alter(env, cell, 19, depth, false, 0.0)
}
fn greenwood(
    env: &mut Environment<'_>,
    field: &MagicField,
    load: &mut MaterialLoad,
    cell: usize,
    seed: i32,
    span: f64,
) -> io::Result<()> {
    if env.water.column.kind.get(cell)? != 0 || !reaches(env, field, cell, seed)? {
        return Ok(());
    }
    let growth = field.channels.band(C::Intensity).get(cell)?;
    if growth >= 200.0 {
        dissolve(env, load, cell, 0.00003 * span * growth / 1000.0)?;
    }
    if growth >= 350.0 {
        let depth = MapScale::native(length(
            env,
            0.0000175 * growth * unwarded(env, cell)? / 1000.0,
        )?);
        alter(env, cell, 20, depth, false, 0.0)?;
    }
    let spring = field
        .definition
        .origins
        .iter()
        .position(|origin| origin.id == "spring");
    if let Some(spring) = spring {
        if field.origins[spring].source.get(cell)? >= 300.0 {
            add_rock(env, cell, 21, 0.0000045 * span * unwarded(env, cell)?)?;
        }
    }
    Ok(())
}
fn dissolve(
    env: &mut Environment<'_>,
    load: &mut MaterialLoad,
    cell: usize,
    fraction: f64,
) -> io::Result<()> {
    let mix = catalogue::compile(ModeMix::default().with(ModeId::Solution, 1.0));
    let power = length(env, fraction)?;
    let mut depths = [0.0; 2];
    for (index, facet) in Facet::ALL.into_iter().enumerate() {
        if env.ground.share(cell, facet)? > 0.0 {
            let limit = (env.ground.surface(cell, facet)? - env.water.effective_sea_level).max(0.0);
            depths[index] = env.ground.act_on(
                SurfaceAction {
                    cell,
                    mix: &mix,
                    power,
                    limit,
                    direction: [0.0; 2],
                },
                facet,
            )?;
        }
    }
    env.ground
        .erode_facets(cell, depths, "greenwood", Pool::Load, &mut |mut parcel| {
            parcel.depth = MapScale::metres(parcel.depth, LengthUnit::Native) * env.mesh.area(cell);
            load.add(cell, &parcel)
        })?;
    Ok(())
}
fn veil(env: &mut Environment<'_>, field: &MagicField, cell: usize, seed: i32) -> io::Result<()> {
    let wild = field.channels.band(C::Wild).get(cell)?;
    if wild < 0.25 || !reaches(env, field, cell, seed)? {
        return Ok(());
    }
    let depth = MapScale::native(length(env, 0.0000225 * wild * unwarded(env, cell)?)?);
    alter(env, cell, 24, depth, false, 0.0)
}
pub fn hallowed(env: &mut Environment<'_>, fields: &[MagicField]) -> io::Result<()> {
    for field in fields
        .iter()
        .filter(|f| f.definition.enabled && f.definition.effects.warding > 0.0)
    {
        let hardening = field.definition.effects.rock_resistance.max(0.0) / 300.0;
        for cell in 0..env.mesh.len() {
            let ward = env.scalar(F::Warding, cell)?;
            if ward > 0.0 && env.water.column.kind.get(cell)? == 0 {
                let depth =
                    MapScale::native(length(env, 0.000075 * ward.clamp(0.0, 1.0) * hardening)?);
                alter(env, cell, 23, depth, false, 0.0)?;
            }
        }
    }
    Ok(())
}
pub fn on_column(
    env: &mut Environment<'_>,
    fields: &mut [MagicField],
    load: &mut MaterialLoad,
    seed: i32,
    span: f64,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        for field in fields
            .iter_mut()
            .filter(|field| field.definition.enabled && field.definition.effects.salting == 0.0)
        {
            leakage::from_column(env.ground, field, cell)?;
        }
        apply_systems(env, fields, load, cell, seed, span)?;
    }
    hallowed(env, fields)
}
fn apply_systems(
    env: &mut Environment<'_>,
    fields: &[MagicField],
    load: &mut MaterialLoad,
    cell: usize,
    seed: i32,
    span: f64,
) -> io::Result<()> {
    let active = || fields.iter().filter(|field| field.definition.enabled);
    for field in active().filter(|field| field.definition.effects.conduit_opening != 0.0) {
        fire(env, field, cell, seed, span)?;
    }
    for field in active().filter(|field| field.definition.effects.stillness != 0.0) {
        aurora(env, field, cell, seed)?;
    }
    for field in active().filter(|field| field.definition.effects.coastal_forcing != 0.0) {
        pressure(env, field, cell, seed)?;
    }
    for field in active().filter(|field| field.definition.effects.verdure != 0.0) {
        greenwood(env, field, load, cell, seed, span)?;
    }
    for field in active().filter(|field| field.definition.effects.tearing != 0.0) {
        veil(env, field, cell, seed)?;
    }
    Ok(())
}
pub fn meeting(
    env: &mut Environment<'_>,
    kind: Option<usize>,
    cell: usize,
    coverage: f64,
    salt: i32,
) -> io::Result<()> {
    let Some(kind) = kind else {
        return Ok(());
    };
    if !in_body(env, cell, coverage, salt)? {
        return Ok(());
    }
    let depth = MapScale::native(length(env, 0.000035 * unwarded(env, cell)?)?);
    alter(env, cell, kind, depth, false, 0.0)
}
