use super::{
    controls,
    motion::site_motion,
    province_selection::{Indices, Read, Selection},
    province_settings::Settings,
    state::State,
};
use crate::{
    field::shared::{CellCode as C, Scalar as S, SharedFields},
    lattice::{TriangularLattice, BLOCK_CELLS},
    rock::ground::{Ground, GroundField as G},
    spatial::SpatialKernel,
};
use std::io;

pub struct Work<'a> {
    pub mesh: &'a TriangularLattice,
    pub state: &'a State,
    pub ground: &'a mut Ground,
    pub fields: &'a mut SharedFields,
    pub forming: bool,
}
fn unit(value: f64) -> f64 {
    (value.clamp(0.0, 1.0) * 1000.0).round()
}
fn motion(value: f64) -> f64 {
    (value.clamp(-1.0, 1.0) * 1000.0).round()
}
pub fn boundary_code(relative: f64, extension: f64, threshold: f64) -> i32 {
    if relative < -threshold {
        1
    } else if relative > threshold || relative > 0.0 && extension >= controls::RIFT_ACTIVATION {
        2
    } else {
        3
    }
}
pub fn bisector_distance(nearest_distance: f64, second_distance: f64, separation: f64) -> f64 {
    (second_distance.powi(2) - nearest_distance.powi(2)) / (2.0 * separation)
}
fn clear_boundary(fields: &mut SharedFields, cell: usize) -> io::Result<()> {
    for name in [C::TectonicBoundaryCodes, C::TectonicBoundaryPairIds] {
        fields.code_mut(name).set(cell, 0)?;
    }
    for name in [S::TectonicStrain, S::TectonicTangentX, S::TectonicTangentY] {
        fields.scalar_mut(name).set(cell, 0.0)?;
    }
    Ok(())
}
fn at_continent_edge(work: &Work<'_>, cell: usize) -> io::Result<bool> {
    let fraction = work.ground.view(G::CrustContinentalFraction);
    for edge in 0..3 {
        if let Some(next) = work.mesh.neighbor(cell, edge) {
            if fraction.get(next)? < 500.0 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn assign_boundary(
    work: &mut Work<'_>,
    settings: &Settings,
    cell: usize,
    selected: &Selection,
) -> io::Result<()> {
    let Some(second) = selected.second else {
        return clear_boundary(work.fields, cell);
    };
    let a = &work.state.sites[selected.nearest].province;
    let b = &work.state.sites[second].province;
    let dx = work.mesh.delta_x(b.position[0] - a.position[0]);
    let dy = b.position[1] - a.position[1];
    let separation = dx.hypot(dy);
    let amount = if selected.held {
        f64::from(at_continent_edge(work, cell)?)
    } else {
        (1.0 - bisector_distance(
            selected.nearest_distance,
            selected.second_distance,
            separation,
        ) / (settings.ridge_width * 0.9).max(0.001))
        .clamp(0.0, 1.0)
    };
    let speed = (b.motion[0] - a.motion[0]).hypot(b.motion[1] - a.motion[1]);
    if amount <= 0.0 || speed < 1e-6 {
        return clear_boundary(work.fields, cell);
    }
    let length = separation.max(0.001);
    let relative = ((b.motion[0] - a.motion[0]) * dx + (b.motion[1] - a.motion[1]) * dy) / length;
    let extension = work
        .state
        .bond(selected.nearest, second)
        .map_or(0.0, |bond| (bond.extension - bond.shortening).max(0.0));
    work.fields.code_mut(C::TectonicBoundaryCodes).set(
        cell,
        boundary_code(relative, extension, settings.tectonic_convergence_threshold),
    )?;
    let pair = (((selected.nearest.min(second) + 1) as i32) << 16)
        | (selected.nearest.max(second) + 1) as i32;
    work.fields
        .code_mut(C::TectonicBoundaryPairIds)
        .set(cell, pair)?;
    work.fields
        .scalar_mut(S::TectonicStrain)
        .set(cell, unit(amount * (speed + extension).clamp(0.0, 1.0)))?;
    let rift = work.fields.scalar_mut(S::CrustRiftStrain);
    rift.set(cell, rift.get(cell)?.max(extension * amount))?;
    let (mut tx, mut ty) = (-dy / length, dx / length);
    if tx < 0.0 || tx.abs() < 0.000001 && ty < 0.0 {
        tx = -tx;
        ty = -ty;
    }
    work.fields
        .scalar_mut(S::TectonicTangentX)
        .set(cell, motion(tx))?;
    work.fields
        .scalar_mut(S::TectonicTangentY)
        .set(cell, motion(ty))
}
fn assign_triangle(
    work: &mut Work<'_>,
    settings: &Settings,
    cell: usize,
    selection: &Selection,
) -> io::Result<()> {
    let site = &work.state.sites[selection.nearest];
    let plate = work
        .state
        .plates
        .iter()
        .find(|p| p.id == site.plate)
        .ok_or_else(|| io::Error::other("Province has no plate"))?;
    work.fields
        .code_mut(C::CrustProvinceIds)
        .set(cell, (selection.nearest + 1) as i32)?;
    work.fields
        .code_mut(C::CrustPlateIds)
        .set(cell, site.plate as i32)?;
    let [vx, vy] = site_motion(work.mesh, work.mesh.position(cell), plate);
    work.fields
        .scalar_mut(S::CrustMotionX)
        .set(cell, motion(vx + site.compliance * (site.drive[0] - vx)))?;
    work.fields
        .scalar_mut(S::CrustMotionY)
        .set(cell, motion(vy + site.compliance * (site.drive[1] - vy)))?;
    let affinity = (0.5
        + (selection.oceanic_distance - selection.continental_distance)
            / (settings.continental_transition_width * 2.0))
        .clamp(0.0, 1.0);
    let potential = if site.province.assembly > 0 {
        affinity.max(settings.continental_crust_potential_floor)
    } else {
        affinity.min(settings.oceanic_crust_potential_ceiling)
    };
    if work.forming {
        let assembly = if affinity <= 0.0 {
            0
        } else if site.province.assembly > 0 {
            site.province.assembly
        } else {
            selection
                .nearest_continental
                .map_or(0, |i| work.state.sites[i].province.assembly)
        };
        work.fields
            .code_mut(C::CrustAssemblyIds)
            .set(cell, assembly as i32)?;
        work.ground
            .initialize_continental_affinity(cell, unit(affinity))?;
    }
    let separation = unit(
        work.fields
            .scalar(S::CrustRiftStrain)
            .get(cell)?
            .clamp(0.0, 1.0)
            * settings.continental_assembly_separation_depth,
    );
    work.fields
        .scalar_mut(S::CrustAssemblySeparation)
        .set(cell, separation)?;
    work.fields
        .scalar_mut(S::CrustBasePotential)
        .set(cell, unit(potential))?;
    work.fields.code_mut(C::CrustTypeCodes).set(
        cell,
        if work.ground.view(G::CrustContinentalFraction).get(cell)? >= 500.0 {
            2
        } else {
            1
        },
    )?;
    assign_boundary(work, settings, cell, selection)
}
pub fn assign(
    work: &mut Work<'_>,
    settings: &Settings,
    kernel: &dyn SpatialKernel,
) -> io::Result<()> {
    let indices = Indices::new(kernel, work.mesh, work.state).map_err(io::Error::other)?;
    for start in (0..work.mesh.len()).step_by(BLOCK_CELLS) {
        let end = (start + BLOCK_CELLS).min(work.mesh.len());
        let selected = indices.select(
            &Read {
                mesh: work.mesh,
                state: work.state,
                ground: work.ground,
                fields: work.fields,
                settings,
                forming: work.forming,
            },
            start..end,
        )?;
        for (offset, selection) in selected.iter().enumerate() {
            assign_triangle(work, settings, start + offset, selection)?;
        }
    }
    for cell in 0..work.mesh.len() {
        let code = work.fields.code(C::TectonicBoundaryCodes).get(cell)?;
        let strain = work.fields.scalar(S::TectonicStrain).get(cell)?;
        work.fields
            .code_mut(C::InitialTectonicBoundaryCodes)
            .set(cell, code)?;
        work.fields
            .scalar_mut(S::InitialTectonicStrain)
            .set(cell, strain)?;
    }
    Ok(())
}
