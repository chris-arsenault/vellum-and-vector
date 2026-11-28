use crate::{
    chance::Chance,
    field::shared::CellCode,
    hpc::SmallIntSet,
    magic::{
        channels::Channel as C, parameters::Parameters, sources::Environment, state::MagicField,
    },
    scale::RelativeMeasure,
};
use std::io;
pub struct Ray {
    pub seed: i32,
    pub source: usize,
    pub angle: f64,
    pub energy: f64,
    pub reach: f64,
    pub wake: bool,
}
struct Beam {
    x: f64,
    y: f64,
    angle: f64,
    energy: f64,
    bounces: i32,
}
fn kernel_weight(env: &Environment<'_>, cell: usize, x: f64, y: f64, radius: f64) -> f64 {
    let [cx, cy] = env.mesh.position(cell);
    let w = env.mesh.cell_width() / 2.0;
    let h = env.mesh.cell_height() / 2.0;
    let x0 = (cx - w).max(x - radius);
    let x1 = (cx + w).min(x + radius);
    let y0 = (cy - h).max(y - radius);
    let y1 = (cy + h).min(y + radius);
    if x1 <= x0 || y1 <= y0 {
        return 0.0;
    }
    let mut weight = 0.0;
    for a in 0..3 {
        for b in 0..3 {
            weight += (1.0
                - (x0 + (a as f64 + 0.5) * (x1 - x0) / 3.0 - x)
                    .hypot(y0 + (b as f64 + 0.5) * (y1 - y0) / 3.0 - y)
                    / radius)
                .max(0.0);
        }
    }
    weight / 9.0 * (x1 - x0) * (y1 - y0)
}
fn cells(env: &Environment<'_>, x: f64, y: f64, radius: f64) -> Vec<usize> {
    let Some(start) = env.mesh.cell_at(x, y) else {
        return vec![];
    };
    let mut queue = vec![start];
    let mut visited = SmallIntSet::default();
    visited.add(start as i32);
    let mut head = 0;
    let mut cells = Vec::new();
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        let [cx, cy] = env.mesh.position(cell);
        if (cx - x).hypot(cy - y) > radius + env.mesh.cell_width().hypot(env.mesh.cell_height()) {
            continue;
        }
        cells.push(cell);
        for edge in 0..3 {
            let Some(next) = env.mesh.neighbor(cell, edge) else {
                continue;
            };
            if visited.add(next as i32) {
                queue.push(next);
            }
        }
    }
    cells
}
struct Paint {
    point: [f64; 2],
    amount: f64,
    distance: f64,
    radius: f64,
    wake: bool,
}
fn paint(env: &Environment<'_>, field: &mut MagicField, paint: Paint) -> io::Result<()> {
    let Paint {
        point: [x, y],
        amount,
        distance,
        radius,
        wake,
    } = paint;
    let mut wet = Vec::new();
    let mut weights = Vec::new();
    let mut total = 0.0;
    for cell in cells(env, x, y, radius) {
        if env.water.column.kind.get(cell)? != 1 {
            continue;
        }
        let weight = kernel_weight(env, cell, x, y, radius);
        wet.push(cell);
        weights.push(weight);
        total += weight;
    }
    if total == 0.0 {
        return Ok(());
    }
    let volume = amount * radius * 2.0 * distance;
    for (cell, weight) in wet.into_iter().zip(weights) {
        let intensity = field.channels.band(C::Intensity).get(cell)?
            + volume * weight / total / env.mesh.area(cell);
        field
            .channels
            .band_mut(C::Intensity)
            .set(cell, intensity.min(1000.0))?;
        if wake && weight > 0.0 {
            field.channels.band_mut(C::Wake).set(cell, 1.0)?;
        }
    }
    Ok(())
}
pub fn trace(
    env: &Environment<'_>,
    field: &mut MagicField,
    p: &Parameters,
    ray: Ray,
) -> io::Result<()> {
    let [x, y] = env.mesh.position(ray.source);
    let mut beam = Beam {
        x,
        y,
        angle: ray.angle,
        energy: ray.energy,
        bounces: 0,
    };
    let step = p.beam_width / 2.0;
    if step <= 0.0 || !step.is_finite() {
        return Err(io::Error::other(
            "Beam width must permit a positive finite step",
        ));
    }
    let origin = env.mesh.origin();
    let mut path = vec![[x + origin[0], y + origin[1]]];
    let mut distance = 0.0;
    while distance < ray.reach && beam.energy > 0.0 {
        let travel = step.min(ray.reach - distance);
        paint(
            env,
            field,
            Paint {
                point: [beam.x, beam.y],
                amount: if ray.wake {
                    beam.energy
                } else {
                    beam.energy * p.ray_intensity / 1000.0
                },
                distance: travel.max(step),
                radius: step,
                wake: ray.wake,
            },
        )?;
        if !advance(env, &mut beam, &ray, travel, distance, p.ray_decay)? {
            break;
        }
        if ray.wake {
            path.push([beam.x + origin[0], beam.y + origin[1]]);
        }
        distance += travel;
    }
    if ray.wake && path.len() > 1 {
        field.wake_paths.push(path);
    }
    Ok(())
}
fn advance(
    env: &Environment<'_>,
    beam: &mut Beam,
    ray: &Ray,
    travel: f64,
    distance: f64,
    decay: f64,
) -> io::Result<bool> {
    let characteristic = env
        .scale
        .resolve(RelativeMeasure::length(0.0025).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let nx = beam.x + beam.angle.cos() * travel;
    let ny = beam.y + beam.angle.sin() * travel;
    let reflects = match env.mesh.cell_at(nx, ny) {
        None => true,
        Some(cell) => {
            env.water.column.kind.get(cell)? != 1
                || env.fields.code(CellCode::FeatureFlags).get(cell)? & (1 << 11) != 0
        }
    };
    if reflects {
        beam.bounces += 1;
        if ray.wake || beam.bounces > 4 {
            return Ok(false);
        }
        beam.angle += std::f64::consts::PI
            * (0.58
                + Chance::of(ray.seed, 0)
                    .unit([(beam.x / characteristic).floor(), beam.bounces as f64])
                    * 0.62);
        beam.energy -= 90.0;
    } else {
        beam.x = nx;
        beam.y = ny;
        if ray.wake {
            beam.angle += Chance::of(ray.seed, 0).signed([
                (distance / characteristic).floor(),
                (beam.x / characteristic).floor(),
            ]) * 0.16
                * travel
                / characteristic;
        } else {
            beam.energy -= decay * (1.0 + beam.bounces as f64 * 0.67) * travel / characteristic;
        }
    }
    Ok(true)
}
