use super::{places, reads, state::State, values::*};
use crate::{
    field::{refinement::topology::distance, shared::Scalar, significance::measure},
    hpc::BitSet,
    magic::channels::Channel,
    rock::ground::GroundField,
    scale::MapScale,
    water::column::Store,
};
use std::io;
pub fn pressure(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(reads::magic_value(state, "pressure", Channel::Intensity, cell)? / 1000.0)
}
pub enum PressureLength {
    RayDistance,
    CoastalRayDistance,
    CoastalSourceDistance,
    WakeDistance,
}
pub fn pressure_length(
    state: &impl State,
    name: PressureLength,
    absent_fraction: f64,
) -> io::Result<f64> {
    if let Some(field) = reads::magic_field(state, "pressure") {
        let p = &field.definition().parameters;
        return Ok(match name {
            PressureLength::RayDistance => p.ray_distance,
            PressureLength::CoastalRayDistance => p.coastal_ray_distance,
            PressureLength::CoastalSourceDistance => p.coastal_source_distance,
            PressureLength::WakeDistance => p.wake_distance,
        });
    }
    if absent_fraction == 0.0 {
        Ok(0.0)
    } else {
        measure(&state.field()?.scale, absent_fraction, 1, 1.0)
    }
}
pub fn area(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(super::water_reads::area_of(state.field()?, place))
}
pub fn extent(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(*state.held().get(&format!("extent:{}", place.id), || {
        let mesh = &state.field()?.mesh;
        Ok(place
            .cells
            .iter()
            .map(|&cell| distance(mesh, place.anchor, cell))
            .fold(0.0, f64::max))
    })?)
}
pub fn near(state: &impl State, fraction: f64) -> io::Result<f64> {
    let scale = &state.field()?.scale;
    Ok(scale.supported(measure(scale, fraction, 1, 1.0)?, 2.0))
}
pub fn sea_facing(state: &impl State, cells: &[usize]) -> io::Result<Vec<usize>> {
    let field = state.field()?;
    let water = field.water().column.kind;
    let mut facing = Vec::new();
    for &cell in cells {
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                if water.get(next)? == 1 {
                    facing.push(cell);
                    break;
                }
            }
        }
    }
    Ok(facing)
}
pub fn shore(state: &impl State, place: &Place) -> io::Result<Vec<usize>> {
    let field = state.field()?;
    let water = field.water().column.kind;
    let mut seen = BitSet::new(field.mesh.len());
    let mut shore = Vec::new();
    for &cell in &place.cells {
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                if !seen.has(next) && water.get(next)? == 0 {
                    seen.add(next);
                    shore.push(next);
                }
            }
        }
    }
    Ok(shore)
}
pub fn exposure(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(state
        .field()?
        .shared
        .scalar(Scalar::WaveExposure)
        .get(cell)?
        / 1000.0)
}
pub fn exposure_beside(state: &impl State, cell: usize) -> io::Result<f64> {
    let mesh = &state.field()?.mesh;
    let mut most = exposure(state, cell)?;
    for edge in 0..3 {
        if let Some(next) = mesh.neighbor(cell, edge) {
            most = most.max(exposure(state, next)?);
        }
    }
    Ok(most)
}
pub fn held_under(state: &impl State, cells: &[usize], depth: f64) -> io::Result<Vec<FieldChange>> {
    let value = state.field()?.water().effective_sea_level - MapScale::native(depth);
    Ok(cells
        .iter()
        .map(|&cell| {
            FieldChange::Physical(PhysicalChange {
                cell,
                band: PhysicalBand::Ground(GroundField::Elevation),
                change: Change::AtMost(value),
            })
        })
        .collect())
}
pub fn depth(state: &impl State, cell: usize) -> io::Result<f64> {
    state
        .field()?
        .water()
        .column
        .store(Store::Standing)
        .held(cell)
}
pub fn fauna(state: &impl State, cell: usize) -> io::Result<f64> {
    let fauna = state
        .field()?
        .shared
        .scalar(Scalar::AquaticFauna)
        .get(cell)?;
    Ok(fauna / (fauna + 0.1))
}
pub fn storm(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(state.field()?.shared.scalar(Scalar::StormTrack).get(cell)? / 1000.0)
}
pub fn named_from_shore(
    state: &impl State,
    place: &Place,
    reach: f64,
) -> io::Result<Option<String>> {
    if places::settlement_within(state, place.anchor, reach)? {
        places::naming_culture_near(state, place)
    } else {
        Ok(None)
    }
}
