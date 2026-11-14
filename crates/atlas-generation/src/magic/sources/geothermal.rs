//! Heat maxima and exhumed ore, with renewal charging actual mineralized intervals.
use super::{site_strength, Context, Environment};
use crate::{
    field::shared::Scalar as F,
    hpc::{BitSet, Direction, MultiKeyHeap, SmallIntSet},
    lattice::Membership,
    magic::{
        channels::Channel as C,
        inventory::{exposure, hosts, Inventory},
        state::{LocatedSource, MagicField},
    },
    noise::hash_unit,
    rock::{
        catalogue::kind_of_code,
        ground::{alteration::Alteration, Charge},
        material::MaterialLayer,
    },
    scale::{MapScale, RelativeMeasure},
    spatial::SpatialKernel,
};
use atlas_map::{Bounds, Geometry, Position};
use std::io;
fn length(env: &Environment<'_>, fraction: f64) -> io::Result<f64> {
    Ok(env
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
fn heat_maximum(env: &Environment<'_>, start: usize, radius: f64) -> io::Result<bool> {
    let here = env.scalar(F::HeatSourceDensity, start)?;
    for edge in 0..3 {
        if let Some(cell) = env.mesh.neighbor(start, edge) {
            if env.scalar(F::HeatSourceDensity, cell)? > here {
                return Ok(false);
            }
        }
    }
    let mut queue = vec![start];
    let mut visited = SmallIntSet::default();
    visited.add(start as i32);
    let [x, y] = env.mesh.position(start);
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        if env.scalar(F::HeatSourceDensity, cell)? > here {
            return Ok(false);
        }
        for edge in 0..3 {
            let Some(next) = env.mesh.neighbor(cell, edge) else {
                continue;
            };
            if !visited.add(next as i32) {
                continue;
            }
            let p = env.mesh.position(next);
            if env.mesh.delta_x(p[0] - x).hypot(p[1] - y) <= radius {
                queue.push(next);
            }
        }
    }
    Ok(true)
}
struct Candidate {
    cell: usize,
    id: i64,
}
fn candidates(
    env: &Environment<'_>,
    field: &MagicField,
    context: Context,
    seed: i32,
) -> io::Result<Vec<Candidate>> {
    let p = field.origin_parameters(context.origin);
    let mut maximum: f64 = 0.0;
    for cell in 0..env.mesh.len() {
        if env.mesh.membership(cell) != Membership::NoData {
            maximum = maximum.max(env.scalar(F::HeatSourceDensity, cell)?);
        }
    }
    let radius = p.source_spacing / 2.0;
    let mut heap = MultiKeyHeap::new([Direction::Descending; 2], Direction::Ascending);
    let sites = field.origins[context.origin].inherited_sites.as_deref();
    let cells: Box<dyn Iterator<Item = usize> + '_> = match sites {
        Some(sites) => Box::new(sites.iter().map(|&i| i as usize)),
        None => Box::new(0..env.mesh.len()),
    };
    for cell in cells {
        if env.mesh.membership(cell) != Membership::Content {
            continue;
        }
        let density = env.scalar(F::HeatSourceDensity, cell)?;
        if density < p.source_threshold
            || env.water.column.kind.get(cell)? == 1
            || field.channels.band(C::Sealed).get(cell)? > 0.0
        {
            continue;
        }
        if density != maximum && !heat_maximum(env, cell, radius)? {
            continue;
        }
        let [x, y] = env.mesh.position(cell);
        heap.push(
            cell as u32,
            [
                density,
                hash_unit(seed, (x / radius).floor(), (y / radius).floor()),
            ],
        );
    }
    let mut result = Vec::new();
    while let Some((cell, keys)) = heap.pop() {
        result.push(Candidate {
            cell: cell as usize,
            id: (keys[1] * 2147483647.0 + 0.5).floor() as i64,
        });
    }
    Ok(result)
}
pub fn locate(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    seed: i32,
    kernel: &dyn SpatialKernel,
) -> io::Result<()> {
    exhumed(env, field, context)?;
    if context.activity <= 0.0 {
        return Ok(());
    }
    let p = field.origin_parameters(context.origin);
    let candidates = candidates(env, field, context, seed)?;
    if candidates.is_empty() {
        return Ok(());
    }
    let width = env.mesh.periodic_width().unwrap_or(0.0);
    let shifts = if width > 0.0 {
        vec![-width, 0.0, width]
    } else {
        vec![0.0]
    };
    let mut points = Vec::new();
    for shift in shifts {
        for candidate in &candidates {
            let [x, y] = env.mesh.position(candidate.cell);
            points.push(Geometry::Point {
                coordinates: Position::xy(x + shift, y),
            });
        }
    }
    let index = kernel.index(&points).map_err(io::Error::other)?;
    let mut selected = BitSet::new(candidates.len());
    let spacing_scale = length(env, 0.0025)?;
    for (number, candidate) in candidates.iter().enumerate() {
        let [x, y] = env.mesh.position(candidate.cell);
        let density = env.scalar(F::HeatSourceDensity, candidate.cell)?;
        let spacing = p.source_spacing + (1000.0 - density) * spacing_scale / 150.0;
        let point = Geometry::Point {
            coordinates: Position::xy(x, y),
        };
        let mut near = false;
        if spacing > 0.0 {
            for hit in index
                .query(Bounds(x - spacing, y - spacing, x + spacing, y + spacing))
                .map_err(io::Error::other)?
            {
                if selected.has(hit % candidates.len())
                    && kernel
                        .distance(&point, &points[hit])
                        .map_err(io::Error::other)?
                        < spacing
                {
                    near = true;
                    break;
                }
            }
        }
        if near {
            continue;
        }
        selected.add(number);
        let strength = ((720.0 + (density / 3.0).trunc()) * context.activity).clamp(1.0, 1000.0);
        field
            .channels
            .band_mut(C::Source)
            .set(candidate.cell, strength)?;
        field.located.push(LocatedSource {
            origin: String::new(),
            id: format!("geothermal:{seed}:{}", candidate.id),
            x,
            y,
            radius: p.source_spacing,
            strength,
        });
    }
    Ok(())
}
fn exhumed(env: &Environment<'_>, field: &mut MagicField, context: Context) -> io::Result<()> {
    let Some(spent) = field.stock_index(context.origin, "spent") else {
        return Ok(());
    };
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let values = &field.origins[context.origin].stocks[spent];
        let ore = values.get(env.ground, cell)?;
        if ore <= 0.0 || env.water.column.kind.get(cell)? == 1 {
            continue;
        }
        let accessible = match values {
            Inventory::Ground(key) => {
                env.ground
                    .inventory_reached(*key, cell, MapScale::native(p.bury_depth))?
            }
            Inventory::Mobile(_) => {
                ore * exposure(
                    env.ground,
                    cell,
                    p.bury_depth,
                    hosts(&field.definition.id, "spent"),
                )?
            }
        };
        let strength = site_strength(accessible * p.exhumed_release / env.mesh.area(cell));
        if strength > 0.0 {
            let before = field.channels.band(C::Source).get(cell)?;
            field
                .channels
                .band_mut(C::Source)
                .set(cell, before.max(strength))?;
        }
    }
    Ok(())
}
pub fn supply(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    seed: i32,
    kernel: &dyn SpatialKernel,
) -> io::Result<()> {
    if context.activity <= 0.0 {
        return Ok(());
    }
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        if field.channels.band(C::Sealed).get(cell)? <= 0.0
            || env.scalar(F::TectonicStrain, cell)? < p.reopen_strain
        {
            continue;
        }
        field.channels.band_mut(C::Sealed).set(cell, 0.0)?;
        let history = field
            .channels
            .band(C::History)
            .get(cell)?
            .min(p.conduit_budget * (1.0 - p.reopen_share));
        field.channels.band_mut(C::History).set(cell, history)?;
    }
    for cell in 0..env.mesh.len() {
        field.channels.band_mut(C::Source).set(cell, 0.0)?;
    }
    field.located.clear();
    locate(env, field, context, seed, kernel)?;
    let Some(held) = field.stock_index(context.origin, "held") else {
        return Ok(());
    };
    let Inventory::Ground(key) = field.origins[context.origin].stocks[held] else {
        return Ok(());
    };
    let vein_depth = length(env, 0.00015)?;
    for source in &field.located {
        let Some(cell) = env.mesh.cell_at(source.x, source.y) else {
            continue;
        };
        let depth = MapScale::native(vein_depth * source.strength / 1000.0);
        let epoch = env.ground.completed_epochs();
        env.ground.alter(
            cell,
            &Alteration {
                depth,
                offset: 0.0,
                from_rock: true,
                retained_only: false,
                transform: &|layer| mineralize(layer, 14, epoch),
                facet: None,
            },
        )?;
        env.ground.inventory_charge(
            key,
            cell,
            &Charge {
                amount: source.strength * env.mesh.area(cell),
                reach: depth,
                hosts: &[14],
                from_rock: true,
                start: 0.0,
            },
        )?;
    }
    Ok(())
}
pub(crate) fn mineralize(was: &MaterialLayer, kind: usize, epoch: f64) -> Option<MaterialLayer> {
    if was.kind == kind && was.secondary_share == 0.0 {
        return None;
    }
    Some(MaterialLayer {
        kind,
        secondary_kind: kind,
        secondary_share: 0.0,
        strength: kind_of_code(kind).facts.resistance,
        altered: epoch,
        ..was.clone()
    })
}
