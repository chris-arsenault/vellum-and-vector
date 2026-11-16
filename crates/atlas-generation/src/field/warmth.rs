use super::{shared::Scalar as S, Field};
use crate::{
    execution::{ExecutionError, Query, QueryDependency},
    lattice::Membership,
    noise::hash_unit,
    processes::runner::PhysicalContext,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    scale_settings::{ResolvedSettings, ScaleDefinition},
};
use serde::Deserialize;
use std::io;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "WarmthPocketCount":15,
        "WarmthPocketMinRadius":{"kind":"relative-measure","fraction":0.025,"dimension":1,"exponent":1},
        "WarmthPocketMaxRadius":{"kind":"relative-measure","fraction":0.07,"dimension":1,"exponent":1},
        "WarmthPocketMinStrength":170,"WarmthPocketMaxStrength":390,
        "HeartWarmthRadius":{"kind":"relative-measure","fraction":0.07,"dimension":1,"exponent":1},
        "HeartWarmthStrength":310,"OceanCurrentWarmthStrength":120,
        "PeakElevationThreshold":{"kind":"relative-measure","fraction":0.0003125,"dimension":1,"exponent":1}
    }})).expect("Declared warmth settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    warmth_pocket_count: f64,
    warmth_pocket_min_radius: f64,
    warmth_pocket_max_radius: f64,
    warmth_pocket_min_strength: f64,
    warmth_pocket_max_strength: f64,
    heart_warmth_radius: f64,
    heart_warmth_strength: f64,
    ocean_current_warmth_strength: f64,
    peak_elevation_threshold: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
fn candidates(field: &Field, p: &Settings) -> io::Result<[Vec<usize>; 4]> {
    let mut result: [Vec<usize>; 4] = Default::default();
    let peak = MapScale::native(p.peak_elevation_threshold);
    let near = field
        .scale
        .resolve(RelativeMeasure::length(0.03).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let inland = field
        .scale
        .resolve(RelativeMeasure::length(0.05).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    for cell in 0..field.mesh.len() {
        if field.mesh.membership(cell) != Membership::Content {
            continue;
        }
        if field.water.borrow().kind_at(cell)? == 1 {
            result[0].push(cell);
            continue;
        }
        let distance = field.shared.scalar(S::OceanDistance).get(cell)?;
        let elevation = field.ground().view(GroundField::Elevation).get(cell)?;
        if distance > 0.0 && distance <= near {
            result[1].push(cell);
        }
        if distance >= inland && elevation < peak {
            result[2].push(cell);
        }
        if elevation >= peak && field.shared.scalar(S::Geothermal).get(cell)? >= 420.0 {
            result[3].push(cell);
        }
    }
    Ok(result)
}
fn source(
    field: &Field,
    candidates: &[usize],
    selected: &[usize],
    seed: i32,
    index: usize,
) -> io::Result<usize> {
    if candidates.is_empty() {
        return field
            .mesh
            .cell_at(0.0, 0.0)
            .ok_or_else(|| io::Error::other("Warmth source outside lattice"));
    }
    let scale = field
        .scale
        .resolve(
            RelativeMeasure::new(6.25e-6, 2, 1.0, LengthUnit::Metre).map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    let (mut best, mut best_score) = (candidates[0], -f64::MAX);
    for sample in 0..96.min(candidates.len()) {
        let cell = candidates[(hash_unit(seed, index as f64, sample as f64)
            * candidates.len() as f64)
            .trunc() as usize
            % candidates.len()];
        let a = field.mesh.position(cell);
        let distance = if selected.is_empty() {
            0.0
        } else {
            selected
                .iter()
                .map(|&other| {
                    let b = field.mesh.position(other);
                    let dx = field.mesh.delta_x(a[0] - b[0]) as f32;
                    let dy = (a[1] - b[1]) as f32;
                    f64::from(dx * dx + dy * dy)
                })
                .fold(f64::INFINITY, f64::min)
        };
        let score = distance / scale
            + field.shared.scalar(S::Geothermal).get(cell)? * 0.25
            + field.shared.scalar(S::OceanCurrentHeat).get(cell)? * 0.22
            + hash_unit(
                seed ^ 0x4b67,
                f64::from(field.mesh.identity(cell)),
                sample as f64,
            );
        if score > best_score {
            best = cell;
            best_score = score;
        }
    }
    Ok(best)
}
fn paint(field: &Field, position: [f64; 2], radius: f64, strength: f64) -> io::Result<()> {
    if radius <= 0.0 {
        return Err(io::Error::other("Invalid radial field extent"));
    }
    let mut warmth = field.shared.derive_scalar(S::Warmth);
    for cell in 0..field.mesh.len() {
        let at = field.mesh.position(cell);
        let distance =
            field.mesh.delta_x(at[0] - position[0]).powi(2) + (at[1] - position[1]).powi(2);
        if distance > radius * radius {
            continue;
        }
        let amount = 1.0 - distance.sqrt() / radius;
        let next = warmth.get(cell)?.max((strength * amount * amount).round());
        warmth.set(cell, next)?;
    }
    Ok(())
}
fn run(field: &Field, p: &Settings, seed: i32) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        let amount = if field.water.borrow().kind_at(cell)? == 1 {
            (field.shared.scalar(S::OceanCurrentHeat).get(cell)? * p.ocean_current_warmth_strength
                / 1000.0)
                .trunc()
        } else {
            0.0
        };
        field.shared.derive_scalar(S::Warmth).set(cell, amount)?;
    }
    paint(
        field,
        [0.0, 0.0],
        p.heart_warmth_radius,
        p.heart_warmth_strength,
    )?;
    let groups = candidates(field, p)?;
    let mut selected = Vec::new();
    for index in 0..p.warmth_pocket_count.ceil().max(0.0) as usize {
        let cell = source(field, &groups[index % 4], &selected, seed, index)?;
        selected.push(cell);
        let radius = p.warmth_pocket_min_radius
            + (p.warmth_pocket_max_radius - p.warmth_pocket_min_radius)
                * hash_unit(seed ^ 0x14d3, index as f64, 0.0);
        let strength = (p.warmth_pocket_min_strength
            + (p.warmth_pocket_max_strength - p.warmth_pocket_min_strength)
                * hash_unit(seed ^ 0x29f1, index as f64, 1.0))
        .round();
        paint(field, field.mesh.position(cell), radius, strength)?;
    }
    Ok(())
}
impl Field {
    pub fn warmth_sources(
        settings: Settings,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "warmth-sources",
            dependencies,
            move |field: &Field, scope| {
                let context = scope.input::<PhysicalContext>()?;
                run(field, &settings, context.seed)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
}
