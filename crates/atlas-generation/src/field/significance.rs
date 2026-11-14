//! The same geographic publication rules judge every map in its own MapScale.
use super::region_evidence::Evidence;
use crate::scale::{LengthUnit, MapScale, RelativeMeasure};
use std::io;

pub fn measure(scale: &MapScale, fraction: f64, dimension: i32, exponent: f64) -> io::Result<f64> {
    Ok(scale
        .resolve(
            RelativeMeasure::new(fraction, dimension, exponent, LengthUnit::Metre)
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value())
}
pub struct Extent {
    pub area: f64,
    pub span: f64,
}
pub struct Judgment {
    pub publish: bool,
    pub reason: &'static str,
}
fn decision(publish: bool, reason: &'static str) -> Judgment {
    Judgment { publish, reason }
}
pub const LANDSCAPE_WORLD_SHARE: f64 = 0.0015;
pub const WETLAND_WORLD_SHARE: f64 = 0.0003;
pub const LANDSCAPE_MINIMUM_BREADTH: f64 = 0.003;
pub const LANDSCAPE_COHERENCE: f64 = 0.6;
pub const LANDSCAPE_CONTRAST: f64 = 0.15;
pub const LANDSCAPE_MINIMUM_AREA: f64 = 0.000125;
pub const LANDSCAPE_STRONG_INTERIOR: f64 = 0.75;
pub fn landscape(
    world: &Extent,
    kind: &str,
    evidence: &Evidence,
    scale: &MapScale,
) -> io::Result<Judgment> {
    let share = if kind == "wetland" {
        WETLAND_WORLD_SHARE
    } else {
        LANDSCAPE_WORLD_SHARE
    };
    let minimum = measure(scale, LANDSCAPE_MINIMUM_AREA, 2, 1.0)?.max(world.area * share);
    if evidence.area < minimum
        || evidence.breadth < measure(scale, LANDSCAPE_MINIMUM_BREADTH, 1, 1.0)?
    {
        return Ok(decision(false, "local extent or narrow habitat"));
    }
    if evidence.coherence < LANDSCAPE_COHERENCE {
        return Ok(decision(
            false,
            "dispersed patches without a coherent landscape",
        ));
    }
    Ok(decision(
        evidence.contrast >= LANDSCAPE_CONTRAST || evidence.strength >= LANDSCAPE_STRONG_INTERIOR,
        "sustained landscape with a distinct margin or strong interior character",
    ))
}
pub const LARGE_DOMAIN_LAND_SHARE: f64 = 0.2;
pub const LARGE_DOMAIN_SPAN: f64 = 0.225;
pub const LARGE_DOMAIN_AREA: f64 = 0.075;
pub fn large_domain(area: f64, span: f64, land: f64, scale: &MapScale) -> io::Result<bool> {
    Ok(span >= measure(scale, LARGE_DOMAIN_SPAN, 1, 1.0)?
        && (area >= land * LARGE_DOMAIN_LAND_SHARE
            || area >= measure(scale, LARGE_DOMAIN_AREA, 2, 1.0)?))
}
pub use crate::water::{
    network::{RIVER_CATCHMENT, RIVER_DISCHARGE},
    significance::{RiverEvidence, OUTLET_DISCHARGE, RIVER_LENGTH},
};
pub fn river_shortfalls(
    evidence: &RiverEvidence,
    scale: &MapScale,
) -> io::Result<Vec<&'static str>> {
    Ok(crate::water::significance::RiverSignificance::at(scale)
        .map_err(io::Error::other)?
        .shortfalls(evidence))
}
pub fn river(evidence: &RiverEvidence, scale: &MapScale) -> io::Result<Judgment> {
    Ok(decision(
        crate::water::significance::RiverSignificance::at(scale)
            .map_err(io::Error::other)?
            .publish(evidence),
        "major water transport and drainage role",
    ))
}
pub const PEAK_ISOLATION: f64 = 0.015;
pub const FALLS_DROP: f64 = 0.00001;
pub const FALLS_DISCHARGE: f64 = 3.90625e-18;
pub const RANGE_AREA: f64 = 0.0005;
pub const RANGE_BREADTH: f64 = 0.00375;
pub const RANGE_SPAN: f64 = 0.025;
pub const RANGE_RELIEF: f64 = 0.00015;
pub fn range(evidence: &Evidence, scale: &MapScale) -> io::Result<Judgment> {
    Ok(decision(
        evidence.area >= measure(scale, RANGE_AREA, 2, 1.0)?
            && evidence.breadth >= measure(scale, RANGE_BREADTH, 1, 1.0)?
            && evidence.span >= measure(scale, RANGE_SPAN, 1, 1.0)?
            && evidence.relief >= measure(scale, RANGE_RELIEF, 1, 0.5)?,
        "broad mountain system with substantial relief",
    ))
}
pub const EXCEPTIONAL_LAKE_AREA: f64 = 0.00001875;
pub const LAKE_DEPTH: f64 = 0.00005;
pub const SEA_AREA: f64 = 0.0005;
pub const OCEAN_AREA: f64 = 0.003125;
pub const MARINE_BREADTH: f64 = 0.0075;
pub fn marine(area: f64, breadth: f64, ocean: bool, scale: &MapScale) -> io::Result<Judgment> {
    Ok(decision(
        area >= measure(scale, if ocean { OCEAN_AREA } else { SEA_AREA }, 2, 1.0)?
            && breadth >= measure(scale, MARINE_BREADTH, 1, 1.0)?,
        "substantial coastal basin or open ocean domain",
    ))
}
pub struct IndependenceEvidence {
    pub residents: f64,
    pub capacity: f64,
    pub years: f64,
    pub connected_residents: f64,
    pub institution: bool,
}
pub const INDEPENDENT_BASE_RESIDENTS: f64 = 1000.0;
pub const INDEPENDENT_BASE_YEARS: f64 = 100.0;
pub const INDEPENDENT_REGIONAL_RESIDENTS: f64 = 5000.0;
pub const INDEPENDENT_INSTITUTION_RESIDENTS: f64 = 2000.0;
pub fn independence(evidence: &IndependenceEvidence) -> Judgment {
    let viable = evidence.residents >= INDEPENDENT_BASE_RESIDENTS
        && evidence.capacity >= evidence.residents
        && evidence.years >= INDEPENDENT_BASE_YEARS;
    decision(viable && (evidence.connected_residents >= INDEPENDENT_REGIONAL_RESIDENTS || (evidence.institution && evidence.residents >= INDEPENDENT_INSTITUTION_RESIDENTS)), "sustained independent authority with a viable population and institutional or regional base")
}
