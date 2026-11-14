use super::{
    sites,
    state::State,
    values::{Carried, Cost, Place, Unrealized},
};
use crate::{features::Feature, hpc::BitSet, lattice::Membership};
use atlas_map::{Geometry, Position};
use std::io;

pub fn locating_cell(state: &impl State, feature: &Feature) -> io::Result<Option<usize>> {
    let stated = feature.attributes.get("representative");
    let x = stated.and_then(|v| v.get("x")).and_then(|v| v.as_f64());
    let y = stated.and_then(|v| v.get("y")).and_then(|v| v.as_f64());
    let at = match (x, y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Position::xy(x, y),
        _ => state
            .spatial()
            .interior_position(&feature.geometry)
            .map_err(io::Error::other)?,
    };
    let [x, y, _] = at.coordinates();
    let mesh = &state.field()?.mesh;
    let [ox, oy] = mesh.origin();
    Ok(mesh.cell_at(x - ox, y - oy))
}
fn covered_cells(state: &impl State, feature: &Feature, cell: usize) -> io::Result<Vec<usize>> {
    if !matches!(
        feature.geometry,
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
    ) {
        return Ok(vec![cell]);
    }
    let mesh = &state.field()?.mesh;
    let cells = mesh
        .window_cells(
            state
                .spatial()
                .bounds(&feature.geometry)
                .map_err(io::Error::other)?,
        )
        .into_iter()
        .filter(|&cell| mesh.membership(cell) == Membership::Content)
        .collect::<Vec<_>>();
    let [ox, oy] = mesh.origin();
    let points = cells
        .iter()
        .map(|&cell| {
            let [x, y] = mesh.position(cell);
            Position::xy(x + ox, y + oy)
        })
        .collect::<Vec<_>>();
    let covered = state
        .spatial()
        .covers_points(&feature.geometry, &points)
        .map_err(io::Error::other)?;
    let found = cells
        .into_iter()
        .zip(covered)
        .filter_map(|(cell, cover)| cover.then_some(cell))
        .collect::<Vec<_>>();
    Ok(if found.is_empty() { vec![cell] } else { found })
}
pub fn where_it_lands(state: &impl State, feature: &Feature) -> io::Result<Option<Carried>> {
    let Some(cell) = locating_cell(state, feature)? else {
        return Ok(None);
    };
    if state.field()?.mesh.membership(cell) != Membership::Content {
        return Ok(None);
    }
    Ok(Some(Carried {
        feature: feature.clone(),
        cell,
        cells: covered_cells(state, feature, cell)?,
    }))
}
pub fn counterpart(
    state: &impl State,
    carried: &Carried,
    parent_span: f64,
    parent_cells: f64,
    is_a: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<Option<usize>> {
    sites::nearest_where(
        &state.field()?.mesh,
        state.spatial(),
        carried.cell,
        parent_cells * parent_span,
        is_a,
    )
}
pub fn moves_to(cell: Option<usize>) -> Unrealized {
    cell.map_or(Unrealized::Keep, Unrealized::Move)
}
pub fn ground_of(state: &impl State, place: &Place, radius: f64) -> io::Result<Vec<usize>> {
    if radius <= 0.0 {
        return Ok(place.cells.clone());
    }
    let mesh = &state.field()?.mesh;
    let mut seen = BitSet::new(mesh.len());
    let mut cells = Vec::new();
    for cell in place
        .cells
        .iter()
        .copied()
        .chain(sites::within(mesh, place.anchor, radius))
    {
        if !seen.has(cell) {
            seen.add(cell);
            cells.push(cell);
        }
    }
    Ok(cells)
}
pub fn cost_near(
    state: &impl State,
    place: &Place,
    factor: f64,
    reach: f64,
) -> io::Result<Vec<Cost>> {
    Ok(ground_of(state, place, reach)?
        .into_iter()
        .map(|cell| Cost { cell, factor })
        .collect())
}
