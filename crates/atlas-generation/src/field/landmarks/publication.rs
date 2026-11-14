//! A landmark claims its own signature, not the other geography around it.
use super::{
    canyon::{self, Canyon},
    catalogue::{Kind, Landmark},
    measurement::distance,
    path::Path,
    placement::place,
};
use crate::{
    field::{landmark_ledger::LandmarkRecord, Field},
    scale::{LengthUnit, MapScale},
    spatial::SpatialKernel,
};
use std::io;
pub fn footprint_reach(landmark: &Landmark, scale: MapScale) -> f64 {
    let km = |key: &str| MapScale::metres(landmark.parameters[key], LengthUnit::Kilometre);
    if landmark.kind.system().is_some() {
        return km("reach");
    }
    match landmark.kind {
        Kind::VolcanicMountain | Kind::ResistantMountain => km("baseRadius"),
        Kind::Canyon => scale.supported(km("rimWidth") / 2.0, 0.6),
        Kind::DomeRing | Kind::ImpactRing => km("diameter") / 2.0,
        Kind::Escarpment => km("scarpWidth"),
        _ => scale.cells(1.0),
    }
}
pub fn claimed_cells(
    field: &Field,
    landmark: &Landmark,
    record: &LandmarkRecord,
    kernel: &dyn SpatialKernel,
) -> io::Result<Vec<usize>> {
    let Some(placed) = place(field, landmark, None)? else {
        return Ok(Vec::new());
    };
    if landmark.kind.system().is_some() {
        return Ok(Vec::new());
    }
    let p = &landmark.parameters;
    let km = |key: &str| MapScale::metres(p[key], LengthUnit::Kilometre);
    if landmark.kind == Kind::Canyon {
        return canyon::floor_cells(
            field,
            &Canyon {
                id: landmark.id.clone(),
                path: placed.path,
                rim_width_km: p["rimWidth"],
                depth_metres: p["depth"],
                capture_distance_km: p["captureDistance"],
            },
            &record.corridor,
            kernel,
        );
    }
    if landmark.kind == Kind::Escarpment {
        let hits = Path::new(&field.mesh, &placed.path).hits(field, kernel)?;
        let width = km("scarpWidth");
        let mut cells = Vec::new();
        for cell in 0..field.mesh.len() {
            if hits.distance.get(cell)? <= width {
                cells.push(cell);
            }
        }
        return Ok(cells);
    }
    let radius = match landmark.kind {
        Kind::VolcanicMountain | Kind::ResistantMountain => {
            field.scale.supported(km("baseRadius") / 2.0, 1.0)
        }
        Kind::DomeRing => km("diameter") / 2.0,
        Kind::ImpactRing => {
            km("diameter") / 2.0 + field.scale.supported(km("diameter") * 0.17, 1.0)
        }
        _ => field.scale.cells(1.0),
    };
    Ok((0..field.mesh.len())
        .filter(|&cell| distance(field, cell, placed.center) <= radius)
        .collect())
}
