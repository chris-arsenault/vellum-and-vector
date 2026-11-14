//! Deferred material settlement. Ground owns material; stages allocate starting-state requests.
pub mod removal;
pub mod stage;
use crate::storage::{Band, Coverage, ReadBand};
use std::io;

#[derive(Clone, Copy, Debug)]
pub enum Sharing {
    Simultaneous,
    Sequential,
}
pub struct Demand {
    pub amount: ReadBand<f64>,
    pub available: ReadBand<f64>,
}

/// Allocate one source pool/facet against its starting state. Different cells never compete.
pub fn allocate(
    demands: &[Demand],
    sharing: Sharing,
    coverage: &mut Coverage,
) -> io::Result<Vec<Band<f64>>> {
    let length = demands.first().map_or(0, |demand| demand.amount.len());
    if demands
        .iter()
        .any(|d| d.amount.len() != length || d.available.len() != length)
    {
        return Err(io::Error::other(
            "Source demand and availability columns must align",
        ));
    }
    let mut grants: Vec<_> = demands
        .iter()
        .map(|_| coverage.scratch(length, 0.0))
        .collect();
    for cell in 0..length {
        allocate_cell(demands, sharing, &mut grants, cell)?;
    }
    Ok(grants)
}
fn allocate_cell(
    demands: &[Demand],
    sharing: Sharing,
    grants: &mut [Band<f64>],
    cell: usize,
) -> io::Result<()> {
    let mut total = 0.0;
    for demand in demands {
        let amount = demand.amount.get(cell)?;
        if !amount.is_finite() || amount < 0.0 {
            return Err(io::Error::other(
                "Material demand must be finite and nonnegative",
            ));
        }
        total += amount;
    }
    if total == 0.0 {
        return Ok(());
    }
    if !total.is_finite() {
        return Err(io::Error::other(
            "Material demand exceeds numeric representation",
        ));
    }
    let mut used = 0.0;
    for (demand, grant) in demands.iter().zip(grants) {
        let wanted = demand.amount.get(cell)?;
        let available = demand.available.get(cell)?;
        if available.is_nan() || available < 0.0 {
            return Err(io::Error::other(
                "Material availability must be nonnegative",
            ));
        }
        let amount = match sharing {
            Sharing::Simultaneous => wanted * (available / total).min(1.0),
            Sharing::Sequential => wanted.min((available - used).max(0.0)),
        };
        grant.set(cell, amount)?;
        used += amount;
    }
    Ok(())
}

/// A routed move is scaled by its own source's grant, never a world or cause-wide fraction.
pub fn route_grant(requested: f64, granted: f64, volume: f64) -> Result<f64, &'static str> {
    if ![requested, granted, volume]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.0)
    {
        return Err("Routed material requires finite nonnegative source values");
    }
    if requested == 0.0 {
        return Ok(0.0);
    }
    Ok(volume * granted / requested)
}
