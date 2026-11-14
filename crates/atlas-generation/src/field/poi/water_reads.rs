use super::{sites, state::State, values::Place};
use crate::{
    field::{shared::Scalar, Field},
    water::network::RiverTerrain,
};
use std::io;
pub fn flow_target(field: &Field, cell: usize) -> io::Result<Option<usize>> {
    let water = field.water.borrow();
    let view = water.read_only();
    water.river_reader().successor(
        cell,
        None,
        &RiverTerrain {
            mesh: &field.mesh,
            water_kind: &view.column.kind,
            targets: &view.routing.targets,
        },
    )
}
pub fn inflows(field: &Field, cell: usize) -> io::Result<Vec<usize>> {
    let targets = field.water().routing.targets;
    let mut cells = Vec::new();
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            if targets.get(next)? == cell as i32 {
                cells.push(next);
            }
        }
    }
    Ok(cells)
}
pub fn area_of(field: &Field, place: &Place) -> f64 {
    place
        .cells
        .iter()
        .map(|&cell| field.mesh.content_area(cell))
        .sum()
}
pub fn dryness_around(state: &impl State, place: &Place, radius: f64) -> io::Result<f64> {
    let field = state.field()?;
    let around = sites::within(&field.mesh, place.anchor, radius);
    let moisture = field.shared.scalar(Scalar::Moisture);
    let mut wet = 0.0;
    for &cell in &around {
        wet += moisture.get(cell)? / 1000.0;
    }
    Ok((1.0 - wet / around.len() as f64).clamp(0.0, 1.0))
}
