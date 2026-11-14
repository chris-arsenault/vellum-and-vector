use super::{contract::Visibility, places, reads, sites, state::State, values::Place};
use crate::field::refinement::topology::distance;
use std::io;

pub fn sized(size: f64, typical: f64) -> f64 {
    if size > 0.0 {
        size / (size + typical)
    } else {
        0.0
    }
}
pub fn stands_out(
    state: &impl State,
    place: &Place,
    radius: f64,
    read: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<f64> {
    let around = sites::within(&state.field()?.mesh, place.anchor, radius);
    let stride = around.len().div_ceil(64).max(1);
    let mut sum = 0.0;
    let mut count = 0;
    let mut least = f64::INFINITY;
    let mut most = f64::NEG_INFINITY;
    for &cell in around.iter().step_by(stride) {
        let value = read(cell)?;
        sum += value;
        count += 1;
        least = least.min(value);
        most = most.max(value);
    }
    let range = most - least;
    let value = (read(place.anchor)? - sum / count as f64) / range;
    Ok(if range > 0.0 && value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    })
}
pub fn alone_among(
    state: &impl State,
    place: &Place,
    others: &[Place],
    reach: f64,
) -> io::Result<f64> {
    let distance = places::nearest_place(state, place, others)?;
    Ok(if distance == f64::INFINITY {
        1.0
    } else {
        distance / (distance + reach)
    })
}
pub fn attachment(state: &impl State, place: &Place, reach: f64) -> io::Result<f64> {
    let field = state.field()?;
    let mut tie = 0.0f64;
    for town in reads::settlements(state)?.iter() {
        if town.attributes.get("namedAfter").and_then(|v| v.as_str()) == Some(&place.id) {
            return Ok(1.0);
        }
        let Some(cell) = reads::feature_cell(field, town) else {
            continue;
        };
        let gap = distance(&field.mesh, cell, place.anchor);
        if gap > reach {
            continue;
        }
        let role: f64 = match town
            .attributes
            .get("settlementRole")
            .and_then(|v| v.as_str())
        {
            Some("capital") => 1.0,
            Some("regionalCapital") => 0.7,
            Some("marketTown") => 0.45,
            _ => 0.0,
        };
        let people = town
            .attributes
            .get("population")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let size = 0.45 * people / (people + 2000.0);
        tie = tie.max(role.max(size) * (1.0 - gap / reach));
    }
    Ok(tie)
}
pub struct Weights {
    pub magnitude: f64,
    pub local_conditions: f64,
    pub isolation: f64,
}
pub fn weighed<S>(
    state: &S,
    place: &Place,
    factors: &Visibility<S>,
    weights: &Weights,
) -> io::Result<f64> {
    let mut physical = 0.0;
    for (weight, factor) in [
        (weights.magnitude, &factors.magnitude),
        (weights.local_conditions, &factors.local_conditions),
        (weights.isolation, &factors.isolation),
    ] {
        if let Some(factor) = factor.value() {
            physical += weight * factor(state, place)?;
        }
    }
    let total = weights.magnitude + weights.local_conditions + weights.isolation;
    physical /= if total == 0.0 { 1.0 } else { total };
    let cultural = factors
        .cultural
        .value()
        .map(|f| f(state, place))
        .transpose()?
        .unwrap_or(0.0);
    Ok(physical.max(cultural))
}
