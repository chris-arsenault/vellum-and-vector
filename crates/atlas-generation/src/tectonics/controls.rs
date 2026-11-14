//! Geological controls from world/tectonicControls.ts; dimensional values resolve through MapScale.
use crate::scale::{MapScale, RelativeMeasure};

pub const REFERENCE_MYR: f64 = 10.0;
pub const DEFAULT_MYR: f64 = 20.0;
pub const STEP_MYR: f64 = 4.0;
pub const GEOMETRY_TRAVEL_FRACTION: f64 = 0.25;
pub const RELAXATION_MYR: f64 = 15.0;
pub const CONTACT_MYR: f64 = 30.0;
pub const SUBDUCTION_RESISTANCE: f64 = 0.0;
pub const SLAB_PULL: f64 = 1.0;
pub const ROTATION_GAIN: f64 = 0.35;
pub const INITIAL_PROVINCES_PER_PLATE: f64 = 5.0;
pub const LOCAL_DRIVING_SHARE: f64 = 0.45;
pub const RIFT_FAILURE: f64 = 0.28;
pub const DUCTILE_COMPLIANCE: f64 = 0.2;
pub const CONTINENT_BOND_STRENGTH: f64 = 4.0;
pub const SUTURE_STRENGTH: f64 = 0.25;
pub const INSULATION_MYR: f64 = 60.0;
pub const PLUME_HEAD_REACH: f64 = 3.0;
pub const COLLISION_LOCK: f64 = 0.5;
pub const SINKING_REACH: f64 = 0.5;
pub const WELD_STRAIN: f64 = 0.2;
pub const WELD_SPEED: f64 = 0.08;
pub const RIFT_ACTIVATION: f64 = 0.02;
pub const RIFT_COOLING_MYR: f64 = 30.0;
pub const OCEAN_MATURITY_MYR: f64 = 80.0;
pub const ARC_MELT_SHARE: f64 = 0.18;

// owner-direction(2026-11-07, restated 2026-11-12): plate movement and tectonic strength cannot be coupled.
pub fn plate_travel(drift_per_myr: f64, duration_myr: f64, travel_share: f64) -> f64 {
    drift_per_myr * duration_myr.max(0.0) * travel_share.max(0.0)
}
fn length(scale: MapScale, share: f64) -> Result<f64, &'static str> {
    Ok(scale.resolve(RelativeMeasure::length(share)?)?.value())
}
pub fn step_travel(scale: MapScale) -> Result<f64, &'static str> {
    length(scale, 0.0175)
}
pub fn edge_reach(scale: MapScale) -> Result<f64, &'static str> {
    length(scale, 0.075)
}
pub fn lid_radius(scale: MapScale) -> Result<f64, &'static str> {
    length(scale, 0.375)
}
pub fn rift_subsidence(scale: MapScale) -> Result<f64, &'static str> {
    length(scale, 0.0004)
}
pub fn arc_offset(scale: MapScale) -> Result<f64, &'static str> {
    length(scale, 0.03)
}
pub fn arc_radius(scale: MapScale) -> Result<f64, &'static str> {
    length(scale, 0.02)
}
