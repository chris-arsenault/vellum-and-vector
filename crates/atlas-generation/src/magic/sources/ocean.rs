use super::{pressure_at_depth, Context, Environment};
use crate::{
    hpc::{radix_order, Direction, NumericKey},
    lattice::TriangularLattice,
    magic::{
        channels::Channel,
        propagation::ocean::ocean_area,
        state::{LocatedSource, MagicField},
    },
    scale::{LengthUnit, MapScale, RelativeMeasure},
    spatial::SpatialKernel,
    tectonics::sources::{area_budget, world_candidates, Candidate},
    water::{column::Store, WaterView},
};
use atlas_map::{Geometry, Position};
use std::io;
pub fn deep_site_score(
    mesh: &TriangularLattice,
    scale: &MapScale,
    water: &WaterView,
    cell: usize,
) -> io::Result<f64> {
    let depths = water.column.store(Store::Standing).contents();
    let here = depths.get(cell)?;
    let reach = scale
        .resolve(RelativeMeasure::length(0.0025).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let mut depth = here;
    for edge in 0..3 {
        if let Some(next) = mesh.neighbor(cell, edge) {
            depth +=
                (here - depths.get(next)?).max(0.0) / mesh.edge_length(cell, edge) * reach / 3.0;
        }
    }
    Ok(depth)
}
pub fn locate(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    seed: i32,
    kernel: &dyn SpatialKernel,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let reference = env
        .scale
        .resolve(RelativeMeasure::new(0.39, 2, 1.0, LengthUnit::Metre).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let budget = area_budget(1.0, ocean_area(env)?, reference);
    let captured = field.origins[context.origin].inherited_sites.as_deref();
    let candidates = match captured {
        Some(cells) => cells
            .iter()
            .map(|&cell| Candidate {
                id: cell as usize,
                position: env.mesh.position(cell as usize),
                priority: 0.0,
            })
            .collect(),
        None => world_candidates(
            env.mesh,
            seed,
            budget
                .checked_mul(64)
                .ok_or_else(|| io::Error::other("Ocean candidate count exceeds address space"))?
                .max(2048),
        ),
    };
    let mut accepted = Vec::new();
    let mut scores = Vec::new();
    let mut priorities = Vec::new();
    for candidate in candidates {
        let Some(cell) = env
            .mesh
            .cell_at(candidate.position[0], candidate.position[1])
        else {
            continue;
        };
        if env.water.column.kind.get(cell)? != 1 {
            continue;
        }
        scores.push(deep_site_score(env.mesh, env.scale, env.water, cell)?);
        priorities.push(candidate.priority);
        accepted.push(candidate);
    }
    let order = radix_order(
        &[NumericKey::Float(&scores), NumericKey::Float(&priorities)],
        Direction::Descending,
    )
    .map_err(io::Error::other)?;
    let selected = if captured.is_some() {
        order
    } else {
        separated(
            env,
            &accepted,
            &order,
            [budget as f64, p.ray_distance / 2.0],
            kernel,
        )?
    };
    let reference_depth = env
        .scale
        .resolve(RelativeMeasure::length(0.0005).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    for index in selected {
        let source = accepted[index];
        let Some(cell) = env.mesh.cell_at(source.position[0], source.position[1]) else {
            continue;
        };
        let strength = pressure_at_depth(
            env.water.column.store(Store::Standing).held(cell)?,
            reference_depth,
        );
        field
            .channels
            .band_mut(Channel::Source)
            .set(cell, strength)?;
        field.located.push(LocatedSource {
            origin: String::new(),
            id: format!("deep-ocean:{}", source.id),
            x: source.position[0],
            y: source.position[1],
            radius: p.beam_width,
            strength,
        });
    }
    Ok(())
}
fn separated(
    env: &Environment<'_>,
    candidates: &[Candidate],
    order: &[usize],
    [count, spacing]: [f64; 2],
    kernel: &dyn SpatialKernel,
) -> io::Result<Vec<usize>> {
    let mut selected: Vec<usize> = Vec::new();
    for &index in order {
        if selected.len() as f64 >= count {
            break;
        }
        let [x, y] = candidates[index].position;
        let point = Geometry::Point {
            coordinates: Position::xy(x, y),
        };
        // Candidate records are sparse named sites; exact distances remain the spatial adapter's operation.
        let mut near = false;
        for &held in &selected {
            let p = candidates[held].position;
            let other = Geometry::Point {
                coordinates: Position::xy(x + env.mesh.delta_x(p[0] - x), p[1]),
            };
            if kernel.distance(&point, &other).map_err(io::Error::other)? < spacing {
                near = true;
                break;
            }
        }
        if !near {
            selected.push(index);
        }
    }
    Ok(selected)
}
