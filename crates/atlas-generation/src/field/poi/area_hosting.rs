//! Captured places follow the actual cells of their retained host, including disjoint courses.
use super::{
    kinds::AreaKind,
    map_records::native_position,
    river_courses::{river_id_at, RiverState},
    values::HostLink,
};
use crate::{features::Feature, reconstruction::Grid};
use atlas_map::{Geometry, Position};
use std::io;

pub fn link_on(
    state: &impl RiverState,
    kind: AreaKind,
    cell: usize,
) -> io::Result<Option<HostLink>> {
    match kind {
        AreaKind::River => Ok(river_id_at(state, cell)?.map(|host_id| HostLink {
            host: kind,
            host_id,
        })),
        // These catalogue entries have no hosting implementation in the source.
        _ => Ok(None),
    }
}

fn located(grid: &Grid, point: Position) -> Geometry {
    let [x, y, _] = point.coordinates();
    let Some(width) = grid.periodic_width.filter(|&width| width > 0.0) else {
        return Geometry::Point { coordinates: point };
    };
    let [west, south, east, north] = grid.bounds;
    if x >= west && x <= east && y >= south && y <= north {
        return Geometry::Point { coordinates: point };
    }
    let first = ((west - x) / width).ceil() as i64;
    let last = ((east - x) / width).floor() as i64;
    let shifts: Vec<_> = if first <= last {
        (first..=last).collect()
    } else {
        vec![(((west + east) / 2.0 - x) / width + 0.5).floor() as i64]
    };
    let coordinates: Vec<_> = shifts
        .into_iter()
        .map(|shift| match point {
            Position::XY([x, y]) => Position::xy(x + shift as f64 * width, y),
            Position::XYZ([x, y, z]) => Position::XYZ([x + shift as f64 * width, y, z]),
        })
        .collect();
    if coordinates.len() == 1 {
        Geometry::Point {
            coordinates: coordinates[0],
        }
    } else {
        Geometry::MultiPoint { coordinates }
    }
}

pub fn hosted_cell(
    state: &impl RiverState,
    surface: &Grid,
    feature: &Feature,
) -> io::Result<Option<usize>> {
    if !state.regional() {
        return Ok(None);
    }
    let Some(link) = feature.attributes.get("hostedBy").filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let link: HostLink = serde_json::from_value(link.clone()).map_err(io::Error::other)?;
    if link.host != AreaKind::River {
        return Ok(None);
    }
    let field = state.field()?;
    let water = field.water.borrow();
    let kind = water.read_only().column.kind;
    let mut cells = Vec::new();
    for reach in water
        .rivers()
        .reaches()
        .filter(|reach| reach.drawn() && reach.river() == Some(link.host_id.as_str()))
    {
        for &cell in reach.cells() {
            if kind.get(cell)? != 1 {
                cells.push(cell);
            }
        }
    }
    if cells.is_empty() {
        return Ok(None);
    }
    let spatial = state.spatial();
    let point = spatial
        .interior_position(&feature.geometry)
        .map_err(io::Error::other)?;
    let point = spatial
        .interior_position(&located(surface, point))
        .map_err(io::Error::other)?;
    let points = cells
        .iter()
        .map(|&cell| {
            Ok(Geometry::Point {
                coordinates: native_position(state, cell)?,
            })
        })
        .collect::<io::Result<Vec<_>>>()?;
    let index = spatial.index(&points).map_err(io::Error::other)?;
    Ok(index
        .nearest(point)
        .map_err(io::Error::other)?
        .and_then(|at| cells.get(at).copied()))
}
