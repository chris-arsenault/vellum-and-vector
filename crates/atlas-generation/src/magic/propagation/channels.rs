//! Fracture and root propagation keep their distinct passage rules and costs.
use crate::{
    field::shared::Scalar as F,
    hpc::{Direction, KeyedHeap},
    magic::{
        channels::Channel as C,
        hallowed::WARD_SEALS,
        sources::{Context, Environment},
        state::MagicField,
    },
    rock::ground::GroundField,
    scale::{LengthUnit, RelativeMeasure},
    storage::{Coverage, ReadBand},
};
use std::io;
#[derive(Clone, Copy)]
pub enum Network {
    Fractures,
    Roots,
}
pub struct Route<'a> {
    pub network: Network,
    pub context: Context,
    pub source: &'a ReadBand<f64>,
    pub placed_cost: Option<&'a ReadBand<f64>>,
}
pub fn propagate(
    env: &Environment<'_>,
    field: &mut MagicField,
    route: Route<'_>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let p = field.origin_parameters(route.context.origin);
    let denominator = env
        .scale
        .resolve(RelativeMeasure::length(0.00025).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let soil_floor = env
        .scale
        .resolve(
            RelativeMeasure::new(0.000000075, 1, 0.5, LengthUnit::Metre)
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    let mut parents = coverage.allocate(-1i32);
    let mut queue = KeyedHeap::new([Direction::Descending], Direction::Ascending);
    for cell in 0..env.mesh.len() {
        let source = route.source.get(cell)?;
        if source > 0.0 {
            let intensity = (source * route.context.activity + 0.5)
                .floor()
                .clamp(0.0, 1000.0);
            field.channels.band_mut(C::Intensity).set(cell, intensity)?;
            queue.push(cell as u32, [intensity]);
        }
    }
    while let Some((cell, [value])) = queue.pop() {
        let cell = cell as usize;
        if field.channels.band(C::Intensity).get(cell)? != value {
            continue;
        }
        for edge in 0..3 {
            let Some(next) = env.mesh.neighbor(cell, edge) else {
                continue;
            };
            let Some(cost) = passage(env, route.network, &p, [cell, next], soil_floor)? else {
                continue;
            };
            let placed = match route.placed_cost {
                Some(values) => values.get(next)?,
                None => 1.0,
            };
            let next_value = value - cost * env.mesh.edge_length(cell, edge) * placed / denominator;
            if next_value <= field.channels.band(C::Intensity).get(next)? {
                continue;
            }
            field
                .channels
                .band_mut(C::Intensity)
                .set(next, next_value)?;
            parents.set(next, cell as i32)?;
            queue.push(next as u32, [next_value]);
        }
    }
    field.parents = Some(parents);
    Ok(())
}
fn passage(
    env: &Environment<'_>,
    network: Network,
    p: &crate::magic::parameters::Parameters,
    [cell, next]: [usize; 2],
    soil_floor: f64,
) -> io::Result<Option<f64>> {
    match network {
        Network::Fractures => {
            if env.scalar(F::Warding, next)? >= WARD_SEALS {
                return Ok(None);
            }
            let conductance = (env.scalar(F::FractureConductance, cell)?
                + env.scalar(F::FractureConductance, next)?)
                / 2.0;
            Ok(Some(
                p.base_cost + (1000.0 - conductance) / p.conductance_divisor,
            ))
        }
        Network::Roots => {
            let cover = env.scalar(F::TreeCover, next)?
                + env.scalar(F::GrassCover, next)?
                + env.scalar(F::WetlandCover, next)?;
            if !env.land_without_ice(next)?
                || (cover < p.root_floor
                    && env.ground.view(GroundField::SoilDepth).get(next)? < soil_floor)
            {
                return Ok(None);
            }
            Ok(Some(p.root_cost / (0.1 + cover)))
        }
    }
}
