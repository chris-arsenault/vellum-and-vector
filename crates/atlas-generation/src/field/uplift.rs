//! Initial crust thickness and interior relief from world/uplift.ts.
use super::{
    shared::{CellCode as C, FloatField as F, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, QueryDependency},
    noise::{hash_unit, mesh_noise},
    processes::runner::PhysicalContext,
    rock::ground::GroundField as G,
    scale::{MapScale, RelativeMeasure},
    scale_settings::ResolvedSettings,
};
use serde::Deserialize;
use std::io;

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    interior_relief_scale: f64,
    interior_relief_strength: f64,
    interior_basin_depth_share: f64,
    elevation_variation_scale: f64,
    elevation_variation_strength: f64,
    elevation_scale: f64,
    epoch_tectonic_elevation_step: f64,
}
fn length(scale: MapScale, fraction: f64) -> io::Result<f64> {
    Ok(scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
fn interior(field: &Field, p: &Settings, c: &PhysicalContext, cell: usize) -> io::Result<f64> {
    let continentality =
        ((field.shared.scalar(S::ContinentalPotential).get(cell)? / 1000.0 - 0.45) / 0.25)
            .clamp(0.0, 1.0);
    if continentality <= 0.0 {
        return Ok(0.0);
    }
    let [x, y] = field.mesh.position(cell);
    let mut relief = mesh_noise(
        &field.mesh,
        x,
        y,
        c.epoch_stable_seed ^ 0x5ee1,
        p.interior_relief_scale,
        4,
    ) * p.interior_relief_strength;
    if relief < 0.0 {
        relief *= p.interior_basin_depth_share / 1000.0;
    }
    Ok(continentality * relief)
}
fn initialize(field: &Field, p: &Settings, c: &PhysicalContext, cell: usize) -> io::Result<()> {
    let [x, y] = field.mesh.position(cell);
    let province = field.shared.code(C::CrustProvinceIds).get(cell)?;
    let variation = mesh_noise(
        &field.mesh,
        x,
        y,
        c.seed ^ 0x52c9,
        p.elevation_variation_scale,
        3,
    ) * p.elevation_variation_strength;
    let offset = if province < 0 {
        0.0
    } else {
        (hash_unit(c.seed ^ 0x3d7b, f64::from(province), f64::from(0x51a9)) - 0.5)
            * 2.0
            * length(field.scale, 0.00013)?
    };
    let relief = interior(field, p, c, cell)?
        - field.shared.scalar(S::CrustAssemblySeparation).get(cell)? / 1000.0
        + variation;
    let mut ground = field.ground.try_borrow_mut().map_err(io::Error::other)?;
    let fraction = ground.view(G::CrustContinentalFraction).get(cell)? / 1000.0;
    let bounded = fraction.clamp(0.0, 1.0);
    let buoyancy = 300.0 + 400.0 * bounded;
    let foundation = length(field.scale, 0.00025 + 0.00075 * bounded)?;
    let column =
        (foundation + offset * fraction + relief * p.elevation_scale / (buoyancy / 1000.0))
            .max(0.0);
    ground.adjust_crust(cell, MapScale::native(column))?;
    let height = length(field.scale, -0.00005 + 0.0001 * bounded)?
        + (column - foundation) * buoyancy / 1000.0;
    ground.stand_surface(cell, MapScale::native(height))
}
impl Field {
    pub fn tectonic_uplift(
        settings: &ResolvedSettings,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> io::Result<Command<Self, PhysicalContext>> {
        let p: Settings = serde_json::from_value(settings.values().clone())?;
        Ok(Command::with_inputs(
            "tectonic-uplift",
            CommandKind::Initialize,
            dependencies,
            move |scope, c: &PhysicalContext| {
                let field: &mut Field = scope.state_mut();
                for cell in 0..field.mesh.len() {
                    if field.crust_forming() {
                        initialize(field, &p, c, cell)?;
                    }
                    let inherited = (field.shared.scalar(S::TectonicActivityHistory).get(cell)?
                        / (p.epoch_tectonic_elevation_step * 1.8).max(1.0))
                    .clamp(0.0, 1.0);
                    let suture = field.ground().view(G::CrustSutureStrength).get(cell)? / 1000.0;
                    let continental =
                        field.shared.scalar(S::ContinentalPotential).get(cell)? / 1000.0;
                    field.shared.float_mut(F::Uplift).set(
                        cell,
                        (continental * 0.32 + inherited * 0.3 + suture * 0.74).clamp(0.0, 1.5)
                            as f32,
                    )?;
                    field.shared.float_mut(F::RidgeInfluence).set(
                        cell,
                        (suture * 0.92).max(inherited * 0.52).clamp(0.0, 1.0) as f32,
                    )?;
                }
                Ok(())
            },
        ))
    }
}
