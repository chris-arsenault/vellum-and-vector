//! Existing located-area interface samples. Independent regional maps do not supply these rules.
use super::super::state::State;
use crate::{
    reconstruction::{extrema::Field, Interpolator},
    storage::Coverage,
};
use atlas_map::Position;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io};

#[derive(Clone, Serialize, Deserialize)]
pub struct Sample {
    pub point: [f64; 2],
    // hpc-exempt: declared interface facts on a sparse boundary record.
    pub values: BTreeMap<String, f64>,
}
pub fn validate(
    samples: &[Sample],
    state: &State,
    field: &Field<'_>,
    fact: &str,
    coverage: &mut Coverage,
) -> io::Result<()> {
    // hpc-exempt: sparse interface records, not numerical cell storage.
    let selected = samples
        .iter()
        .filter_map(|sample| {
            sample
                .values
                .get(fact)
                .map(|value| (field.grid.chart(sample.point), *value))
        })
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Ok(());
    }
    let points = selected
        .iter()
        .map(|(point, _)| Position::xy(point[0], point[1]))
        .collect::<Vec<_>>();
    let covered = state
        .spatial
        .covers_points(field.footprint, &points)
        .map_err(io::Error::other)?;
    let mut sample = Interpolator::new(field.grid, field.discrete, coverage);
    for ((point, expected), covered) in selected.into_iter().zip(covered) {
        if !covered {
            continue;
        }
        let difference = (sample.sample(point, &|cell| field.values.get(cell))? - expected).abs();
        if !difference.is_finite() || difference > state.scope.precision {
            return Err(io::Error::other(format!(
                "Retain {}'s inherited {fact} samples; reconcile the boundary to change them",
                state.scope.area_name,
            )));
        }
    }
    Ok(())
}
