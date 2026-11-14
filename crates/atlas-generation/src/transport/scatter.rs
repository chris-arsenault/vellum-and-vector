use super::{
    quantities::{arrived, QuantityKind},
    TransportShares,
};
use crate::storage::{Band, Coverage, ReadBand};
use std::io;

/// Weights are source shares in the plan, target shares when accumulating densities.
pub fn area_weights(
    coverage: &mut Coverage,
    plan: &TransportShares,
    area: impl Fn(usize) -> f64,
) -> io::Result<Band<f64>> {
    let mut weights = coverage.scratch(plan.weights.len(), 0.0);
    for source in 0..plan.offsets.len() - 1 {
        for offset in plan.offsets.get(source)?..plan.offsets.get(source + 1)? {
            let offset = offset as usize;
            let target = plan.targets.get(offset)?;
            if target >= 0 {
                weights.set(
                    offset,
                    plan.weights.get(offset)? * area(source) / area(target as usize),
                )?;
            }
        }
    }
    Ok(weights)
}
pub fn accumulate(
    plan: &TransportShares,
    values: &ReadBand<f64>,
    scratch: &mut Band<f64>,
    area_weights: Option<&ReadBand<f64>>,
) -> io::Result<()> {
    for cell in 0..scratch.len() {
        scratch.set(cell, 0.0)?;
    }
    for source in 0..values.len() {
        let value = values.get(source)?;
        for offset in plan.offsets.get(source)?..plan.offsets.get(source + 1)? {
            let offset = offset as usize;
            let target = plan.targets.get(offset)?;
            if target < 0 {
                continue;
            }
            let target = target as usize;
            let prior = scratch.get(target)?;
            scratch.set(
                target,
                if let Some(weights) = area_weights {
                    prior + value * weights.get(offset)?
                } else {
                    prior.max(value)
                },
            )?;
        }
    }
    Ok(())
}
pub struct ScalarTransport<'a> {
    pub shares: &'a TransportShares,
    pub arrivals: &'a ReadBand<f64>,
    pub boundaries: &'a ReadBand<i32>,
    pub weights: &'a ReadBand<f64>,
}
impl ScalarTransport<'_> {
    pub fn apply(
        &self,
        values: &mut Band<f64>,
        kind: QuantityKind,
        scratch: &mut Band<f64>,
    ) -> io::Result<()> {
        match kind {
            QuantityKind::Share | QuantityKind::Amount | QuantityKind::Peak => (),
            _ => {
                return Err(io::Error::other(
                    "Owner packages and identities cannot be averaged",
                ))
            }
        }
        accumulate(
            self.shares,
            &values.read_only(),
            scratch,
            if kind == QuantityKind::Peak {
                None
            } else {
                Some(self.weights)
            },
        )?;
        for target in 0..values.len() {
            let sum = scratch.get(target)?;
            values.set(
                target,
                if kind == QuantityKind::Peak {
                    sum
                } else {
                    // All shared scalar channels have zero fresh-crust values. Placement belongs to Ground.
                    arrived(
                        kind,
                        sum,
                        self.arrivals.get(target)?,
                        self.boundaries.get(target)?,
                        0.0,
                    )
                },
            )?;
        }
        Ok(())
    }
}
