use super::{
    code,
    components::{Component, Frame},
    ground, length, read, Field, PhysicalContext, Settings, C, G, S,
};
use crate::{
    noise::{hash_unit, unit_noise},
    rock::ground::queries::{surface_response, yielding_plane, Extent, SurfaceResponse},
    scale::MapScale,
};
use std::io;
pub(super) const CREST: f64 = 1.55;
pub(super) fn segment_scale(c: &Component, segment: f64) -> f64 {
    0.75 + 0.5 * hash_unit(c.salt ^ 0x51e4, segment, 1.0)
}
pub(super) fn sheet_at(
    field: &Field,
    p: &Settings,
    c: &Component,
    cell: usize,
    source: usize,
    reach: f64,
) -> io::Result<(i32, f64, i32)> {
    let tx = read(field, S::TectonicTangentX, source)? / 1000.0;
    let ty = read(field, S::TectonicTangentY, source)? / 1000.0;
    let at = field.mesh.position(cell);
    let segment = ((at[0] * tx + at[1] * ty) / p.orogenic_segment_length).floor() as i32;
    let ground = field.ground();
    let stiffness = ground.fold(cell, &surface_response(SurfaceResponse::Standing), None)?;
    let spacing =
        p.orogenic_sheet_spacing * stiffness * (1.0 + ground.inherited_detachment(cell)?);
    let offset = hash_unit(c.salt ^ 0x51e3, f64::from(segment), 0.0) * spacing;
    let position = (reach + offset) / spacing;
    Ok((
        position.floor() as i32,
        position - position.floor(),
        segment,
    ))
}
pub(super) fn cross_section(
    field: &Field,
    c: &Component,
    frame: &Frame,
    cell: usize,
) -> io::Result<f64> {
    if c.code != 1 || ground(field, G::ThrustPairIds, cell)? != f64::from(c.pair) + 1.0 {
        return Ok(0.0);
    }
    let behind =
        (f64::from(c.front_sheet) - (ground(field, G::ThrustSheetIndex, cell)? - 1.0)).max(0.0);
    let stacked = 1.25
        * 0.62f64.powf(behind)
        * (0.3 + 0.7 * frame.overlap.get(cell)?)
        * segment_scale(c, ground(field, G::ThrustSegmentIds, cell)?);
    Ok(stacked * (0.4 + ground(field, G::CrustContinentalFraction, cell)? / 1000.0 * 0.6))
}
fn along_noise(
    field: &Field,
    cells: [usize; 2],
    summit: bool,
    pair: i32,
    seed: i32,
    scale: f64,
) -> io::Result<f64> {
    let [cell, source] = cells;
    let mut tx = read(field, S::TectonicTangentX, source)? / 1000.0;
    let mut ty = read(field, S::TectonicTangentY, source)? / 1000.0;
    if tx.abs() + ty.abs() < 0.01 {
        tx = 1.0;
        if !summit {
            ty = 0.0;
        }
    }
    let [x, y] = field.mesh.position(cell);
    let offset = f64::from(pair) * length(field, if summit { 0.0775 } else { 0.0475 })?;
    let Some(width) = field.mesh.periodic_width() else {
        return Ok(unit_noise(x * tx + y * ty, offset, seed, scale, 3));
    };
    let phase = x.rem_euclid(width);
    let t = phase / width;
    let a = unit_noise(phase * tx + y * ty, offset, seed, scale, 3);
    let b = unit_noise((phase - width) * tx + y * ty, offset, seed, scale, 3);
    Ok(a + (b - a) * t * t * (3.0 - 2.0 * t))
}
pub(super) fn summit(
    field: &Field,
    p: &Settings,
    context: &PhysicalContext,
    c: &Component,
    cell: usize,
    source: usize,
) -> io::Result<f64> {
    Ok(0.72
        + along_noise(
            field,
            [cell, source],
            true,
            c.pair,
            context.epoch_stable_seed ^ 0x19d7,
            (p.orogenic_along_strike_scale * 0.28).max(3.0),
        )?
        .powf(2.1)
            * 0.68)
}
pub(super) fn weight(
    field: &Field,
    p: &Settings,
    context: &PhysicalContext,
    c: &Component,
    frame: &Frame,
    cell: usize,
) -> io::Result<f64> {
    let source = frame.source.get(cell)? as usize;
    let noise = along_noise(
        field,
        [cell, source],
        false,
        c.pair,
        context.epoch_stable_seed ^ 0x6c91,
        p.orogenic_along_strike_scale,
    )?;
    let activity = read(field, S::TectonicStrain, source)? / 1000.0 * 0.62 + c.strain * 0.38;
    Ok(activity * (0.74 + noise.powf(1.7) * 0.54) * cross_section(field, c, frame, cell)?)
}
fn fault_normal(
    field: &Field,
    cell: usize,
    next: usize,
    edge: usize,
) -> io::Result<Option<[f64; 2]>> {
    let at = code(field, C::TectonicBoundaryCodes, cell)?;
    let source = if at == 2 || at == 3 { cell } else { next };
    let active = code(field, C::TectonicBoundaryCodes, source)?;
    if active != 2 && active != 3 {
        return Ok(None);
    }
    let tx = read(field, S::TectonicTangentX, source)?;
    let ty = read(field, S::TectonicTangentY, source)?;
    let length = tx.hypot(ty);
    if length == 0.0 {
        return Ok(None);
    }
    let edge = field.mesh.edge_direction(cell, edge);
    let sign = super::sign(-ty * edge[0] + tx * edge[1]);
    Ok(Some([-ty * sign / length, tx * sign / length]))
}
pub(super) fn fault_blocks(field: &mut Field, p: &Settings) -> io::Result<()> {
    let n = field.mesh.len();
    let coverage = field.coverage.get_mut();
    let mut response = coverage.scratch(n, 0.0);
    let mut sx = coverage.scratch(n, 0.0);
    let mut sy = coverage.scratch(n, 0.0);
    let mut movement = coverage.scratch(n, 0.0);
    let mut weight = coverage.scratch(n, 0.0);
    let query = yielding_plane(|_| 1.0, Extent::Foundation);
    let travel = field.last_plate_drift_step * p.thrust_tilt_gradient;
    for cell in 0..n {
        let plane = field.ground().fold(cell, &query, None)?;
        response.set(cell, plane.compliance)?;
        sx.set(cell, plane.slope_x)?;
        sy.set(cell, plane.slope_y)?;
    }
    for cell in 0..n {
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if next <= cell
                || code(field, C::CrustProvinceIds, cell)?
                    == code(field, C::CrustProvinceIds, next)?
            {
                continue;
            }
            let Some([nx, ny]) = fault_normal(field, cell, next, edge)? else {
                continue;
            };
            let opening = ((read(field, S::CrustMotionX, next)?
                - read(field, S::CrustMotionX, cell)?)
                * nx
                + (read(field, S::CrustMotionY, next)? - read(field, S::CrustMotionY, cell)?) * ny)
                / 1000.0
                * travel;
            let dip =
                ((sx.get(cell)? + sx.get(next)?) * nx + (sy.get(cell)? + sy.get(next)?) * ny) / 2.0;
            let (first, second) = (response.get(cell)?, response.get(next)?);
            let polarity = if dip != 0.0 {
                super::sign(dip)
            } else {
                super::sign(first - second)
            };
            let yielding = first + second;
            let deltas = if opening == 0.0 || yielding <= 0.0 || polarity == 0.0 {
                [0.0; 2]
            } else {
                [
                    -opening * polarity * first / (1.0 + yielding),
                    opening * polarity * second / (1.0 + yielding),
                ]
            };
            let face = field.mesh.face_length(cell, edge);
            for (at, delta) in [cell, next].into_iter().zip(deltas) {
                movement.set(at, movement.get(at)? + MapScale::native(delta) * face)?;
                weight.set(at, weight.get(at)? + face)?;
            }
        }
    }
    for cell in 0..n {
        if weight.get(cell)? > 0.0 {
            movement.set(cell, movement.get(cell)? / weight.get(cell)?)?;
        }
    }
    field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .displace_field(&movement.read_only(), "fault displacement")
}
