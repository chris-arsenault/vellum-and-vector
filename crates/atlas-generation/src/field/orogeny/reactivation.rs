use super::{
    code, crust_per_rock, ground, metres, read, sign, Field, PhysicalContext, Settings, C, G, S,
};
use crate::{
    metric::search::physical_distance,
    rock::ground::queries::{yielding_plane, Extent, YieldingPlane},
    scale::MapScale,
    storage::Band,
};
// hpc-exempt: sparse rift identities; terrain values remain typed bands.
use std::{collections::BTreeMap, io};
const INTERIOR: f64 = 500.0;
const SURFACE: f64 = 0.7;
struct Squeeze {
    xx: Vec<f64>,
    xy: Vec<f64>,
    yy: Vec<f64>,
}
struct Rift {
    distance: Band<f64>,
    pull: Band<f64>,
    source: Band<i32>,
}
fn slot(field: &Field, cell: usize) -> io::Result<usize> {
    Ok((code(field, C::CrustPlateIds, cell)? + 1) as usize)
}
fn interior(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(code(field, C::TectonicBoundaryCodes, cell)? == 0
        && ground(field, G::CrustContinentalFraction, cell)? >= INTERIOR)
}
fn squeeze(field: &Field) -> io::Result<Squeeze> {
    let mut slots = 0;
    for cell in 0..field.mesh.len() {
        slots = slots.max(slot(field, cell)? + 1);
    }
    let mut result = Squeeze {
        xx: vec![0.0; slots],
        xy: vec![0.0; slots],
        yy: vec![0.0; slots],
    };
    let (mut weight, mut maximum) = (vec![0.0; slots], vec![0.0f64; slots]);
    for cell in 0..field.mesh.len() {
        let plate = slot(field, cell)?;
        let code = code(field, C::TectonicBoundaryCodes, cell)?;
        let strain = read(field, S::TectonicStrain, cell)? / 1000.0;
        let push = if code == 1 {
            strain * (read(field, S::CrustCollisionIntensity, cell)? / 1000.0).max(0.5)
        } else if code == 2 && ground(field, G::CrustContinentalFraction, cell)? < INTERIOR {
            strain * 0.5
        } else {
            0.0
        };
        let tx = read(field, S::TectonicTangentX, cell)?;
        let ty = read(field, S::TectonicTangentY, cell)?;
        let length = tx.hypot(ty);
        if push <= 0.0 || length <= 0.0 {
            continue;
        }
        let (nx, ny) = (-ty / length, tx / length);
        result.xx[plate] += push * nx * nx;
        result.xy[plate] += push * nx * ny;
        result.yy[plate] += push * ny * ny;
        weight[plate] += push;
        maximum[plate] = maximum[plate].max(push);
    }
    for plate in 0..slots {
        let scale = if weight[plate] > 0.0 {
            maximum[plate] / weight[plate]
        } else {
            0.0
        };
        result.xx[plate] *= scale;
        result.xy[plate] *= scale;
        result.yy[plate] *= scale;
    }
    Ok(result)
}
fn is_rift(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(code(field, C::TectonicBoundaryCodes, cell)? == 2
        && ground(field, G::CrustContinentalFraction, cell)? >= INTERIOR)
}
fn rifts(field: &mut Field, reach: f64) -> io::Result<Rift> {
    let n = field.mesh.len();
    let coverage = field.coverage.get_mut();
    let mut result = Rift {
        distance: coverage.scratch(n, f64::INFINITY),
        pull: coverage.scratch(n, 0.0),
        source: coverage.scratch(n, -1),
    };
    // hpc-exempt: a handful of rifts keyed by sparse province-pair identities.
    let mut strongest = BTreeMap::<i32, f64>::new();
    for cell in 0..n {
        if !is_rift(field, cell)? {
            continue;
        }
        let held = strongest
            .entry(code(field, C::TectonicBoundaryPairIds, cell)?)
            .or_default();
        *held = held.max(read(field, S::TectonicStrain, cell)? / 1000.0);
    }
    let mut seeds = Vec::new();
    for cell in 0..n {
        if !is_rift(field, cell)? {
            continue;
        }
        result.pull.set(
            cell,
            strongest[&code(field, C::TectonicBoundaryPairIds, cell)?],
        )?;
        result.source.set(cell, cell as i32)?;
        result.distance.set(cell, 0.0)?;
        seeds.push(cell);
    }
    physical_distance(
        &field.mesh,
        seeds,
        &mut result.distance,
        reach,
        |next, cell| {
            result.pull.set(next, result.pull.get(cell)?)?;
            result.source.set(next, result.source.get(cell)?)
        },
    )?;
    Ok(result)
}
fn resolved_loading(xx: f64, xy: f64, yy: f64, gx: f64, gy: f64) -> f64 {
    let coherence = (gx.hypot(gy) / 1000.0).clamp(0.0, 1.0);
    let angle = gy.atan2(gx) / 2.0;
    let (tx, ty) = (angle.cos(), angle.sin());
    let (nx, ny) = (-ty, tx);
    let normal = xx * nx * nx + 2.0 * xy * nx * ny + yy * ny * ny;
    let shear = (tx * (xx * nx + xy * ny) + ty * (xy * nx + yy * ny)).abs();
    (xx + yy) / 2.0 * (1.0 - coherence) + (normal + sign(normal) * shear) * coherence
}
fn stress(
    field: &Field,
    cell: usize,
    squeeze: &Squeeze,
    rift: &Rift,
    reach: f64,
) -> io::Result<YieldingPlane> {
    let near = 1.0 - (rift.distance.get(cell)? / reach).min(1.0);
    let plate = slot(field, cell)?;
    let source = rift.source.get(cell)?;
    let tx = if source >= 0 {
        read(field, S::TectonicTangentX, source as usize)?
    } else {
        0.0
    };
    let ty = if source >= 0 {
        read(field, S::TectonicTangentY, source as usize)?
    } else {
        0.0
    };
    let length = tx.hypot(ty).max(1.0);
    let (nx, ny) = (-ty / length, tx / length);
    let pull = rift.pull.get(cell)? * near;
    let (xx, xy, yy) = (
        squeeze.xx[plate] - pull * nx * nx,
        squeeze.xy[plate] - pull * nx * ny,
        squeeze.yy[plate] - pull * ny * ny,
    );
    field.ground().fold(
        cell,
        &yielding_plane(
            move |material| resolved_loading(xx, xy, yy, material.grain_x, material.grain_y),
            Extent::Foundation,
        ),
        None,
    )
}
fn mark_seams(field: &mut Field) -> io::Result<()> {
    if field.province_seams_marked {
        return Ok(());
    }
    field.province_seams_marked = true;
    for cell in 0..field.mesh.len() {
        if !interior(field, cell)? {
            continue;
        }
        let province = code(field, C::CrustProvinceIds, cell)?;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if code(field, C::CrustProvinceIds, next)? != province
                && ground(field, G::CrustContinentalFraction, next)? >= INTERIOR
            {
                field
                    .ground
                    .try_borrow_mut()
                    .map_err(io::Error::other)?
                    .mark_seam(cell)?;
                break;
            }
        }
    }
    Ok(())
}
fn weak_zones(field: &mut Field, reach: f64) -> io::Result<(Band<f64>, Band<f64>)> {
    let mut distance = field
        .coverage
        .get_mut()
        .scratch(field.mesh.len(), f64::INFINITY);
    let mut weak = field.coverage.get_mut().scratch(field.mesh.len(), 0.0);
    let mut seeds = Vec::new();
    for cell in 0..field.mesh.len() {
        if !interior(field, cell)? {
            continue;
        }
        let here = (ground(field, G::CrustSutureStrength, cell)? / 1000.0).max(
            if ground(field, G::CrustProvinceSeam, cell)? > 0.0 {
                0.4
            } else {
                0.0
            },
        );
        if here <= 0.0 {
            continue;
        }
        weak.set(cell, here)?;
        distance.set(cell, 0.0)?;
        seeds.push(cell);
    }
    physical_distance(&field.mesh, seeds, &mut distance, reach, |next, cell| {
        weak.set(next, weak.get(cell)?)
    })?;
    Ok((distance, weak))
}
fn crust_for(field: &Field, cell: usize, metres: f64) -> io::Result<f64> {
    Ok(metres * (1.0 - SURFACE)
        / ((300.0
            + 400.0
                * (ground(field, G::CrustContinentalFraction, cell)? / 1000.0).clamp(0.0, 1.0))
            / 1000.0))
}
fn unspent(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(ground(field, G::CrustRootReserve, cell)?
        .min(read(field, S::ConvergentCrustSurplus, cell)?)
        .max(0.0))
}
fn spend(field: &mut Field, rise: &Band<f64>, slots: usize) -> io::Result<Vec<f64>> {
    let (mut wanted, mut roots) = (vec![0.0; slots], vec![0.0; slots]);
    for cell in 0..field.mesh.len() {
        let plate = slot(field, cell)?;
        roots[plate] += metres(unspent(field, cell)?) * field.mesh.area(cell);
        let rise = rise.get(cell)?;
        if rise > 0.0 {
            let taken = crust_for(field, cell, rise)?
                + rise
                    * SURFACE
                    * crust_per_rock(ground(field, G::CrustContinentalFraction, cell)? / 1000.0);
            wanted[plate] += taken * field.mesh.area(cell);
        }
    }
    let (mut paid, mut from_roots) = (vec![0.0; slots], vec![0.0; slots]);
    for plate in 0..slots {
        if wanted[plate] <= 0.0 {
            continue;
        }
        paid[plate] = (roots[plate] / wanted[plate]).min(1.0);
        from_roots[plate] = if roots[plate] > 0.0 {
            paid[plate] * wanted[plate] / roots[plate]
        } else {
            0.0
        };
    }
    for cell in 0..field.mesh.len() {
        let amount = unspent(field, cell)? * from_roots[slot(field, cell)?];
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .spend_root_reserve(cell, amount)?;
    }
    Ok(paid)
}
fn move_seam(field: &mut Field, cell: usize, value: f64) -> io::Result<f64> {
    let rock = MapScale::native(value * SURFACE);
    let crust = crust_for(field, cell, value)?;
    if value > 0.0 {
        super::roots::add_root(field, cell, crust * field.mesh.area(cell))?;
    } else {
        let next = MapScale::native(
            (metres(ground(field, G::CrustThickness, cell)?).round() + crust).max(0.0),
        );
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .adjust_crust(cell, next)?;
    }
    if rock > 0.0 {
        let band = field.shared.scalar_mut(S::OrogenicConstruction);
        band.set(cell, band.get(cell)?.max(rock))?;
    }
    Ok(rock)
}
pub(super) fn run(field: &mut Field, p: &Settings, context: &PhysicalContext) -> io::Result<()> {
    let step = p.suture_reactivation_per_span * context.span * context.tectonic_strength / 1000.0;
    if step <= 0.0 {
        return Ok(());
    }
    mark_seams(field)?;
    let squeeze = squeeze(field)?;
    let reach = p.suture_reactivation_zone;
    let (distance, weak) = weak_zones(field, reach)?;
    let rift = rifts(field, reach)?;
    let n = field.mesh.len();
    let mut moves = field.coverage.get_mut().scratch(n, 0.0);
    let mut displacement = field.coverage.get_mut().scratch(n, 0.0);
    let mut raised = field.coverage.get_mut().scratch(n, 0.0);
    for cell in 0..n {
        if !interior(field, cell)? || weak.get(cell)? <= 0.0 {
            continue;
        }
        let plane = stress(field, cell, &squeeze, &rift, reach)?;
        let width =
            reach * plane.mobility.sqrt() * (1.0 + field.ground().inherited_detachment(cell)?);
        let fading = if width > 0.0 {
            (1.0 - distance.get(cell)? / width).max(0.0).powi(2)
        } else {
            0.0
        };
        moves.set(
            cell,
            step * plane.response.clamp(-1.0, 1.0) * weak.get(cell)? * fading,
        )?;
    }
    let paid = spend(field, &moves, squeeze.xx.len())?;
    for cell in 0..n {
        let value = moves.get(cell)?;
        if value == 0.0 {
            continue;
        }
        let plate = slot(field, cell)?;
        let admitted = if value > 0.0 {
            value * paid[plate]
        } else {
            value
        };
        let source = rift.source.get(cell)?;
        let angle = if value < 0.0 && source >= 0 {
            read(field, S::TectonicTangentY, source as usize)?.atan2(read(
                field,
                S::TectonicTangentX,
                source as usize,
            )?)
        } else {
            (2.0 * squeeze.xy[plate]).atan2(squeeze.xx[plate] - squeeze.yy[plate]) / 2.0
                + std::f64::consts::FRAC_PI_2
        };
        let movement = move_seam(field, cell, admitted)?;
        raised.set(cell, movement.max(0.0))?;
        displacement.set(cell, movement.min(0.0))?;
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .deform(
                cell,
                [angle.cos(), angle.sin()],
                weak.get(cell)?,
                MapScale::native(admitted.abs()),
            )?;
    }
    let mut ground = field.ground.try_borrow_mut().map_err(io::Error::other)?;
    ground.displace_field(&displacement.read_only(), "reactivation")?;
    ground.shift_field(&raised.read_only(), "reactivation")
}
