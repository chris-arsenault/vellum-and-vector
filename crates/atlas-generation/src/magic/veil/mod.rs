pub mod doors;
use super::{
    channels::Channel as C,
    parameters::Parameters,
    sources::{Context, Environment},
    state::MagicField,
};
use crate::{
    field::shared::{Scalar as F, SharedFields},
    noise::fractal_noise,
    scale::{MapScale, RelativeMeasure},
    storage::{Coverage, ReadBand},
};
use std::io;
pub struct TearResponse {
    pub strength: f64,
    pub wild: f64,
}
pub fn tear_response(
    strain: f64,
    previous: f64,
    salting: f64,
    activity: f64,
    p: &Parameters,
) -> TearResponse {
    if activity <= 0.0 {
        return TearResponse {
            strength: 0.0,
            wild: 0.0,
        };
    }
    let strained = if strain < p.tear_floor {
        0.0
    } else {
        (1000.0 * (strain - p.tear_floor) / (p.tear_full - p.tear_floor) + 0.5)
            .floor()
            .clamp(1.0, 1000.0)
    };
    let strength = ((strained * activity).max(previous * p.hold_salting * salting) + 0.5)
        .floor()
        .clamp(0.0, 1000.0);
    TearResponse {
        strength,
        wild: ((strength - previous).abs() / 1000.0 / p.wild_shift).clamp(0.0, 1.0),
    }
}
pub fn front_strain(difference: f64, distance: f64, reach: f64) -> f64 {
    if distance > 0.0 {
        (difference.abs() * reach / distance).min(1.0)
    } else {
        0.0
    }
}
pub fn strain_at(
    env: &Environment<'_>,
    a: &ReadBand<f64>,
    b: &ReadBand<f64>,
    cell: usize,
) -> io::Result<f64> {
    let ai = a.get(cell)?;
    let bi = b.get(cell)?;
    let gap = (ai - bi) / 1000.0;
    let reach = env
        .scale
        .resolve(RelativeMeasure::length(0.0025).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let mut front: f64 = 0.0;
    for edge in 0..3 {
        let Some(next) = env.mesh.neighbor(cell, edge) else {
            continue;
        };
        front = front.max(front_strain(
            gap - (a.get(next)? - b.get(next)?) / 1000.0,
            env.mesh.edge_length(cell, edge),
            reach,
        ));
    }
    Ok(ai / 1000.0 * (bi / 1000.0) * front)
}
/// `others` contains enabled non-tearing systems; meetings contribute their current coverage.
pub fn strain_sources(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    others: &[ReadBand<f64>],
    meetings: &[ReadBand<f64>],
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let previous = field.stock_index(context.origin, "held");
    for cell in 0..env.mesh.len() {
        field.channels.band_mut(C::Wild).set(cell, 0.0)?;
        if env.water.column.kind.get(cell)? == 1 {
            continue;
        }
        let mut strain = 0.0;
        for a in 0..others.len() {
            for b in a + 1..others.len() {
                strain += strain_at(env, &others[a], &others[b], cell)?;
            }
        }
        for meeting in meetings {
            strain += meeting.get(cell)?;
        }
        strain *= 1.0 - p.knit_verdure * env.scalar(F::Verdure, cell)?;
        let before = match previous {
            Some(stock) => {
                field.origins[context.origin].stocks[stock].get(env.ground, cell)?
                    / env.mesh.area(cell)
            }
            None => 0.0,
        };
        let response = tear_response(
            strain,
            before,
            env.scalar(F::Salting, cell)?,
            context.activity,
            &p,
        );
        field.channels.band_mut(C::Wild).set(cell, response.wild)?;
        if response.strength > 0.0 {
            field
                .channels
                .band_mut(C::Source)
                .set(cell, response.strength)?;
        }
    }
    Ok(())
}
/// Cover moves locally; the coherent displacement goes through Ground's field operation.
pub fn write(
    env: &mut Environment<'_>,
    field: &MagicField,
    coverage: &mut Coverage,
    epoch: i32,
) -> io::Result<()> {
    let mut movement = coverage.scratch(env.mesh.len(), 0.0);
    let p = &field.definition.parameters;
    let scale = env
        .scale
        .resolve(RelativeMeasure::length(0.025).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let origin = env.mesh.origin();
    for cell in 0..env.mesh.len() {
        let wild = field.channels.band(C::Wild).get(cell)?;
        if wild <= 0.0 || env.water.column.kind.get(cell)? != 0 {
            continue;
        }
        let [x, y] = env.mesh.position(cell);
        let h = fractal_noise(origin[0] + x, origin[1] + y, epoch ^ 0x7e11, scale, 2);
        shuffle(env.fields.material()?, cell, p.wild_shuffle * wild, h > 0.0)?;
        movement.set(cell, MapScale::native(p.wild_relief * wild * h))?;
    }
    env.ground.displace_field(&movement.read_only(), "veil")
}
fn shuffle(fields: &mut SharedFields, cell: usize, share: f64, growing: bool) -> io::Result<()> {
    let grass = fields.scalar(F::GrassCover).get(cell)?;
    let broadleaf = fields.scalar(F::BroadleafCover).get(cell)?;
    if growing {
        let moved = grass * share;
        fields.scalar_mut(F::GrassCover).set(cell, grass - moved)?;
        fields
            .scalar_mut(F::BroadleafCover)
            .set(cell, broadleaf + moved)?;
    } else {
        let conifer = fields.scalar(F::ConiferCover).get(cell)?;
        let trees = broadleaf + conifer;
        let moved = trees * share;
        if trees > 0.0 {
            fields
                .scalar_mut(F::BroadleafCover)
                .set(cell, broadleaf - moved * broadleaf / trees)?;
            fields
                .scalar_mut(F::ConiferCover)
                .set(cell, conifer - moved * conifer / trees)?;
        }
        fields.scalar_mut(F::GrassCover).set(cell, grass + moved)?;
    }
    let trees =
        fields.scalar(F::BroadleafCover).get(cell)? + fields.scalar(F::ConiferCover).get(cell)?;
    fields.scalar_mut(F::TreeCover).set(cell, trees)
}
