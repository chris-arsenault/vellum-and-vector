pub mod coasts;
pub mod rims;
use super::{
    channels::Channel as C,
    sources::{site_strength, Context, Environment},
    state::{LocatedSource, MagicField},
};
use crate::{scale::RelativeMeasure, storage::ReadBand};
use std::io;
pub const WARD_SEALS: f64 = 0.5;
pub struct Seat {
    pub id: String,
    pub cell: usize,
}
pub struct Way {
    pub from: String,
    pub to: String,
}
pub struct Seats<'a> {
    pub living: &'a [Seat],
    pub ways: &'a [Way],
    pub tenure: &'a ReadBand<f64>,
}
/// The place owner supplies living seats (including captured inhabited settlements).
pub fn tenure(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    seats: Seats<'_>,
) -> io::Result<()> {
    // hpc-exempt: counts keyed by named places, not terrain cells.
    let mut ways = std::collections::BTreeMap::<&str, usize>::new();
    for way in seats.ways {
        *ways.entry(&way.from).or_default() += 1;
        *ways.entry(&way.to).or_default() += 1;
    }
    let p = field.origin_parameters(context.origin);
    for seat in seats.living {
        let held = seats.tenure.get(seat.cell)?;
        if held <= 0.0 {
            continue;
        }
        let convergence = ways.get(seat.id.as_str()).copied().unwrap_or(0) as f64;
        let strength =
            site_strength(1000.0 * held / p.tenure_full * (1.0 + p.pilgrimage_bonus * convergence));
        if strength == 0.0 {
            continue;
        }
        let before = field.channels.band(C::Source).get(seat.cell)?;
        field
            .channels
            .band_mut(C::Source)
            .set(seat.cell, before.max(strength))?;
        let [x, y] = env.mesh.position(seat.cell);
        field.located.push(LocatedSource {
            origin: field.definition.origins[context.origin].id.clone(),
            id: format!("seat:{}", seat.id),
            x,
            y,
            radius: p.ward_reach * strength / 1000.0,
            strength,
        });
    }
    Ok(())
}
pub fn kept_lines(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    kept: &ReadBand<f64>,
    walked: &ReadBand<f64>,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        if env.water.column.kind.get(cell)? != 0 {
            continue;
        }
        let strength =
            (1000.0 * (kept.get(cell)? / p.line_full).max(walked.get(cell)? / p.road_full) + 0.5)
                .floor()
                .clamp(0.0, 1000.0);
        if strength >= 100.0 {
            field.channels.band_mut(C::Source).set(cell, strength)?;
        }
    }
    Ok(())
}
pub fn propagate(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    still: Option<&ReadBand<f64>>,
    fire: Option<&ReadBand<f64>>,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let minimum = env
        .scale
        .resolve(RelativeMeasure::length(0.00000025).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    for cell in 0..env.mesh.len() {
        let value = field.channels.band(C::Source).get(cell)?;
        field.channels.band_mut(C::Intensity).set(cell, value)?;
    }
    for seat in &field.located {
        for cell in 0..env.mesh.len() {
            let [x, y] = env.mesh.position(cell);
            let distance = env.mesh.delta_x(x - seat.x).hypot(y - seat.y);
            let force = seat.strength * (1.0 - distance / seat.radius.max(minimum)).max(0.0);
            let before = field.channels.band(C::Intensity).get(cell)?;
            field
                .channels
                .band_mut(C::Intensity)
                .set(cell, before.max(force))?;
        }
    }
    for cell in 0..env.mesh.len() {
        let mut intensity = field.channels.band(C::Intensity).get(cell)?;
        if intensity <= 0.0 {
            continue;
        }
        if let Some(still) = still {
            intensity += p.aurora_reinforce * still.get(cell)? * intensity / 1000.0;
        }
        if let Some(fire) = fire {
            if fire.get(cell)? > 0.0 {
                intensity = 0.0;
            }
        }
        field
            .channels
            .band_mut(C::Intensity)
            .set(cell, intensity.min(1000.0))?;
    }
    Ok(())
}
