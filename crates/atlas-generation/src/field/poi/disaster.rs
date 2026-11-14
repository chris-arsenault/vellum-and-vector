use super::values::{Change, PhysicalBand, PhysicalChange};
use crate::{
    field::{people::land_events::Struck, shared::Scalar},
    rock::ground::GroundField,
    scale::{MapScale, RelativeMeasure},
};
use std::io;
pub fn changes(event: &Struck, scale: &MapScale) -> io::Result<Vec<PhysicalChange>> {
    let strength = event.magnitude.clamp(0.0, 1.0);
    let mut changes = Vec::new();
    let fraction = match event.kind.as_str() {
        "avalanche" => Some(1.25e-6),
        "flood" => Some(1.25e-7),
        "tsunami" => Some(2.5e-7),
        _ => None,
    };
    if let Some(fraction) = fraction {
        let depth = scale
            .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        changes.push(PhysicalChange {
            band: PhysicalBand::Ground(GroundField::SedimentThickness),
            cell: event.cell,
            change: Change::AtLeast(MapScale::native(depth * strength)),
        });
    }
    if ["thermal-fracture", "steam-fracture"].contains(&event.kind.as_str()) {
        changes.push(PhysicalChange {
            band: PhysicalBand::Scalar(Scalar::FractureConductance),
            cell: event.cell,
            change: Change::AtLeast(900.0 * strength),
        });
    }
    if event.kind == "pressure-ice-breach" {
        changes.push(PhysicalChange {
            band: PhysicalBand::Scalar(Scalar::IceThickness),
            cell: event.cell,
            change: Change::AtMost(0.0),
        });
    }
    changes.push(PhysicalChange {
        band: PhysicalBand::Scalar(Scalar::EcologicalDamage),
        cell: event.cell,
        change: Change::AtLeast(0.8 * strength),
    });
    Ok(changes)
}
pub fn accepts(event: &Struck) -> bool {
    !["siege", "battle", "collapse"].contains(&event.kind.as_str())
}
