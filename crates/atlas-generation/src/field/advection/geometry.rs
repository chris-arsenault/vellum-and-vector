use super::super::{events::EventKind, shared::Scalar as S, Field};
use crate::{
    lattice::{sampling::Sampler, TriangularLattice},
    spatial::SpatialKernel,
    tectonics::controls::GEOMETRY_TRAVEL_FRACTION,
};
use atlas_map::{Geometry, Position};
use std::io;

fn move_point(
    mesh: &TriangularLattice,
    velocity: &mut impl FnMut([f64; 2]) -> io::Result<[f64; 2]>,
    mut point: [f64; 2],
    distance: f64,
) -> io::Result<[f64; 2]> {
    let travel = mesh.spacing() * GEOMETRY_TRAVEL_FRACTION;
    let mut remaining = distance;
    while remaining > 0.0 {
        let initial = velocity(point)?;
        if initial == [0.0, 0.0] {
            break;
        }
        let mut step = remaining.min(travel * 1000.0 / initial[0].hypot(initial[1]));
        loop {
            let middle = mesh.point(
                point[0] + initial[0] * step / 2000.0,
                point[1] + initial[1] * step / 2000.0,
            );
            let [vx, vy] = velocity(middle)?;
            let dx = vx * step / 1000.0;
            let dy = vy * step / 1000.0;
            let moved = dx.hypot(dy);
            if !moved.is_finite() || step <= 0.0 {
                return Err(io::Error::other("Motion must resolve a finite step"));
            }
            if moved <= travel {
                if remaining - step >= remaining {
                    return Err(io::Error::other(
                        "Motion step is below numerical resolution",
                    ));
                }
                remaining -= step;
                point = mesh.point(point[0] + dx, point[1] + dy);
                break;
            }
            step /= 2.0;
        }
    }
    Ok(point)
}
fn trace(mesh: &TriangularLattice, points: &[[f64; 2]]) -> Geometry {
    let mut previous = points.first().map_or(0.0, |p| p[0]);
    let coordinates = points
        .iter()
        .map(|&[x, y]| {
            let x = if let Some(width) = mesh.periodic_width() {
                previous + (x - previous) - ((x - previous) / width + 0.5).floor() * width
            } else {
                x
            };
            previous = x;
            Position::xy(x, y)
        })
        .collect();
    Geometry::LineString { coordinates }
}
fn line(shape: Geometry) -> io::Result<Vec<[f64; 2]>> {
    match shape {
        Geometry::LineString { coordinates } => Ok(coordinates
            .into_iter()
            .map(|p| {
                let [x, y, _] = p.coordinates();
                [x, y]
            })
            .collect()),
        _ => Err(io::Error::other(
            "Geological trace resampling must return a line",
        )),
    }
}
fn move_trace(
    mesh: &TriangularLattice,
    kernel: &dyn SpatialKernel,
    points: &[[f64; 2]],
    move_point: &mut impl FnMut([f64; 2]) -> io::Result<[f64; 2]>,
) -> io::Result<Vec<[f64; 2]>> {
    if points.len() < 2 {
        return points.iter().map(|&p| move_point(p)).collect();
    }
    let deviation = mesh.spacing() * 0.125;
    let spacing = mesh.periodic_width().map_or(mesh.spacing() * 0.5, |w| {
        (mesh.spacing() * 0.5).min(w / 4.0)
    });
    let sampled = line(
        kernel
            .resample_trace(&trace(mesh, points), deviation, Some(spacing))
            .map_err(io::Error::other)?,
    )?;
    let moved = sampled
        .into_iter()
        .map(|[x, y]| move_point(mesh.point(x, y)))
        .collect::<io::Result<Vec<_>>>()?;
    let reduced = line(
        kernel
            .resample_trace(
                &trace(mesh, &moved),
                deviation,
                mesh.periodic_width().map(|_| spacing),
            )
            .map_err(io::Error::other)?,
    )?;
    Ok(reduced.into_iter().map(|[x, y]| mesh.point(x, y)).collect())
}
pub(super) fn advect(
    field: &mut Field,
    kernel: &dyn SpatialKernel,
    distance: f64,
) -> io::Result<()> {
    if !distance.is_finite() || distance < 0.0 {
        return Err(io::Error::other(
            "Motion distance must be finite and nonnegative",
        ));
    }
    let xs = field.shared.scalar(S::CrustMotionX);
    let ys = field.shared.scalar(S::CrustMotionY);
    let mesh = &field.mesh;
    // Motion fields stay immutable throughout this interval's geometry move.
    let mut sampler = Sampler::new(mesh);
    let mut velocity = |point| {
        Ok([
            sampler.sample(point, |cell| xs.get(cell))?,
            sampler.sample(point, |cell| ys.get(cell))?,
        ])
    };
    let mut moved = |point| move_point(mesh, &mut velocity, point, distance);
    for event in &mut field.events {
        if event.kind != EventKind::Plume {
            [event.x, event.y] = moved([event.x, event.y])?;
        }
    }
    for record in &mut field.landmark_ledger {
        if let Some(capture) = &mut record.capture {
            [capture.x, capture.y] = moved([capture.x, capture.y])?;
        }
    }
    for fault in &mut field.faults {
        fault.coordinates = move_trace(mesh, kernel, &fault.coordinates, &mut moved)?;
    }
    Ok(())
}
