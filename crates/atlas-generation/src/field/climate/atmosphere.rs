use super::{latitude, ocean, wind::Terrain, wrap, write, Field, Settings};
use crate::{
    field::shared::{CellCode as C, Scalar as S},
    hpc::EpochStamps,
    noise::world_noise,
    processes::runner::PhysicalContext,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale, RelativeMeasure},
};
use std::io;
fn length(field: &Field, share: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(RelativeMeasure::length(share).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
fn belt(p: &Settings, latitude: f64) -> (usize, f64, f64) {
    let width = 90.0 / p.circulation_cells_per_hemisphere.max(1.0);
    let distance = latitude.abs().min(89.999);
    let cell = (distance / width).floor() as usize;
    let within = ((distance - cell as f64 * width) / width * std::f64::consts::PI).sin();
    (cell, within, if latitude >= 0.0 { 1.0 } else { -1.0 })
}
fn direction(field: &Field, p: &Settings, c: &PhysicalContext, cell: usize) -> [f64; 2] {
    let (band, within, poleward) = belt(p, latitude(field, p, cell));
    let westerly = band & 1 == 1;
    let along: f64 = if westerly { 1.0 } else { -1.0 };
    let across =
        if westerly { poleward } else { -poleward } * within * p.circulation_cell_turn / 1000.0;
    let [x, y] = field.mesh.position(cell);
    let [ox, oy] = field.mesh.origin();
    let wander = world_noise(
        &field.mesh,
        x + ox,
        y + oy,
        c.seed ^ 0x713b,
        p.circulation_wander_scale,
        3,
    ) * p.circulation_wander
        / 1000.0;
    let angle = across.atan2(along) + wander;
    [angle.cos(), angle.sin()]
}
fn belt_speed(p: &Settings, latitude: f64) -> f64 {
    let (band, within, _) = belt(p, latitude);
    let peak = if band & 1 == 1 {
        p.wind_speed_westerlies
    } else if band == 0 {
        p.wind_speed_trades
    } else {
        p.wind_speed_polar
    };
    peak * (0.3 + 0.7 * within)
}
fn aligned(field: &Field, cell: usize, [x, y]: [f64; 2]) -> i32 {
    crate::climate::aligned_neighbor(&field.mesh, cell, [x, y]).map_or(-1, |next| next as i32)
}
fn trace(
    field: &Field,
    p: &Settings,
    start: usize,
    visited: &mut EpochStamps<()>,
) -> io::Result<f64> {
    let mut current = start;
    let mut barrier: f64 = 0.0;
    let mut moisture_barrier = -1.0;
    let mut sea = -1;
    let elevation = field.ground().view(G::Elevation);
    let start_elevation = elevation.get(start)?;
    let links = field.shared.code(C::UpwindTargets);
    let reach = length(field, 0.045)?;
    let moisture_reach = length(field, 0.035)?;
    let mut distance = 0.0;
    visited.begin();
    while distance < reach {
        let next = links.get(current)?;
        if next < 0 || visited.marked(next as usize) {
            break;
        }
        distance += field.mesh.physical_distance(current, next as usize);
        if distance > reach {
            break;
        }
        visited.mark(next as usize);
        current = next as usize;
        barrier = barrier.max(elevation.get(current)? - start_elevation);
        if distance <= moisture_reach {
            moisture_barrier = barrier;
        }
        if ocean(field, current)? {
            sea = current as i32;
            break;
        }
    }
    let denominator = length(field, 2.5e-7)?.max(p.elevation_scale / 2.0);
    let normalize = |value| {
        (MapScale::metres(value, LengthUnit::Native) * 1000.0 / denominator)
            .trunc()
            .clamp(0.0, 1000.0)
    };
    write(
        field,
        S::MoistureBarriers,
        start,
        normalize(if moisture_barrier < 0.0 {
            barrier
        } else {
            moisture_barrier
        }),
    )?;
    write(field, S::PrecipitationBarriers, start, normalize(barrier))?;
    field
        .shared
        .derive_code(C::UpwindOceanSources)
        .set(start, sea)?;
    Ok(MapScale::metres(barrier, LengthUnit::Native))
}
pub(super) fn flow(field: &Field, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
    let mut terrain = Terrain::new(field, p)?;
    for cell in 0..field.mesh.len() {
        let [x, y] = terrain.deflect(p, cell, direction(field, p, c, cell))?;
        write(field, S::WindX, cell, (x * 1000.0).round())?;
        write(field, S::WindY, cell, (y * 1000.0).round())?;
        field
            .shared
            .derive_code(C::UpwindTargets)
            .set(cell, aligned(field, cell, [-x, -y]))?;
    }
    wrap::links(
        field,
        p,
        &mut field.shared.derive_code(C::UpwindTargets),
        |_| Ok(true),
    )?;
    let mut visited = EpochStamps::new(field.mesh.len());
    for cell in 0..field.mesh.len() {
        let barrier = trace(field, p, cell, &mut visited)?;
        let speed = terrain.speed(
            field,
            p,
            cell,
            belt_speed(p, latitude(field, p, cell)),
            barrier,
        )?;
        write(field, S::WindSpeed, cell, speed)?;
    }
    Ok(())
}
