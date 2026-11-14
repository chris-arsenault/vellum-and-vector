use super::sources::Environment;
use crate::{field::shared::Scalar, storage::ReadBand};
use std::io;
#[derive(Default)]
pub struct Costs {
    pub crust: Option<ReadBand<f64>>,
    pub roots: Option<ReadBand<f64>>,
    pub river: Option<ReadBand<f64>>,
    pub wind: Option<ReadBand<f64>>,
    pub ice: Option<ReadBand<f64>>,
}
/// A ward and a place's cost describe the same passage, so the stricter one applies.
pub fn passage(
    env: &Environment<'_>,
    cost: Option<&ReadBand<f64>>,
    target: usize,
) -> io::Result<f64> {
    let ward = env.scalar(Scalar::Warding, target)?;
    let admitted = if ward >= 0.5 { 0.0 } else { 1.0 - ward };
    let cost = match cost {
        Some(values) => values.get(target)?,
        None => 1.0,
    };
    Ok(admitted.min(if cost > 0.0 {
        (1.0 / cost).min(1.0)
    } else {
        1.0
    }))
}
