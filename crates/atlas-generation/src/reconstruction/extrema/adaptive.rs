use super::{traces, Field, Query, Range};
use crate::{
    reconstruction::{adaptive::Adaptive, hermite::Patch, topology::Topology},
    spatial::{Overlay, Predicate},
};
use atlas_map::{regions::rectangle, Bounds, Geometry, Position};
use std::io;

struct Piece {
    bounds: [f64; 4],
    region: Geometry,
    cell: usize,
}
fn bernstein(v: [f64; 5]) -> [f64; 5] {
    let a = 256.0 * v[1] - 81.0 * v[0] - v[4];
    let b = 16.0 * v[2] - v[0] - v[4];
    let c = 256.0 * v[3] - v[0] - 81.0 * v[4];
    let sum = (a + c - 18.0 * b) / 48.0;
    let difference = (a - c) / 96.0;
    [
        v[0],
        (sum + difference) / 2.0,
        (b - 4.0 * sum) / 6.0,
        (sum - difference) / 2.0,
        v[4],
    ]
}
fn interval(topology: &Topology, patch: &Patch, piece: &Piece) -> io::Result<[f64; 2]> {
    let b = topology.cell(piece.cell)?;
    let p = piece.bounds;
    let mut controls = [[0.0; 5]; 5];
    for (y, row) in controls.iter_mut().enumerate() {
        *row = bernstein(std::array::from_fn(|x| {
            patch.polynomial(
                (p[0] + (p[2] - p[0]) * x as f64 / 4.0 - b[0]) / (b[2] - b[0]),
                (p[1] + (p[3] - p[1]) * y as f64 / 4.0 - b[1]) / (b[3] - b[1]),
            )
        }));
    }
    for x in 0..5 {
        let column = bernstein(std::array::from_fn(|y| controls[y][x]));
        for (y, row) in controls.iter_mut().enumerate() {
            row[x] = column[y];
        }
    }
    let low = controls
        .iter()
        .flatten()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let high = controls
        .iter()
        .flatten()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    Ok([patch.low.max(low), patch.high.min(high)])
}
fn shape(b: [f64; 4]) -> Geometry {
    rectangle(Bounds(b[0], b[1], b[2], b[3]))
}
fn split(query: &Query<'_>, piece: &Piece, pending: &mut Vec<Piece>) -> io::Result<()> {
    let [x0, y0, x1, y1] = piece.bounds;
    let x = (x0 + x1) / 2.0;
    let y = (y0 + y1) / 2.0;
    for bounds in [
        [x0, y0, x, y],
        [x, y0, x1, y],
        [x0, y, x, y1],
        [x, y, x1, y1],
    ] {
        if let Some(region) = query
            .spatial
            .overlay(&piece.region, &shape(bounds), Overlay::Intersection)
            .map_err(io::Error::other)?
        {
            pending.push(Piece {
                bounds,
                region,
                cell: piece.cell,
            });
        }
    }
    Ok(())
}
pub(super) fn range(
    query: &mut Query<'_>,
    field: &Field<'_>,
    topology: &Topology,
    region: &Geometry,
) -> io::Result<Option<[f64; 2]>> {
    let mut sampler = Adaptive::new(topology, query.coverage);
    let read = |i| field.values.get(i);
    let Bounds(w, s, e, n) = query.spatial.bounds(region).map_err(io::Error::other)?;
    let mut range = Range::default();
    // hpc-exempt: clipped spatial subdivision work, not cell-indexed numerical storage.
    let mut pending = Vec::new();
    topology.visit_overlap([w, s, e, n], |cell| {
        let bounds = topology.cell(cell)?;
        let shape = shape(bounds);
        if !query
            .spatial
            .relation(region, &shape, Predicate::Intersects)
            .map_err(io::Error::other)?
        {
            return Ok(());
        }
        if field.discrete {
            range.add(read(cell)?);
        } else if query
            .spatial
            .relation(region, &shape, Predicate::Covers)
            .map_err(io::Error::other)?
        {
            let patch = sampler.patch(cell, &read)?;
            range.add(read(cell)?);
            for corner in [0, 4, 8, 12] {
                range.add(patch.coefficients[corner]);
            }
        } else if let Some(region) = query
            .spatial
            .overlay(region, &shape, Overlay::Intersection)
            .map_err(io::Error::other)?
        {
            pending.push(Piece {
                bounds,
                region,
                cell,
            });
        }
        Ok(())
    })?;
    while let Some(piece) = pending.pop() {
        sample_piece(query, &mut sampler, &read, &piece, &mut range)?;
        let [minimum, maximum] = interval(topology, &sampler.patch(piece.cell, &read)?, &piece)?;
        let [low, high] = range.0.unwrap_or([f64::INFINITY, f64::NEG_INFINITY]);
        if minimum >= low - query.precision && maximum <= high + query.precision {
            continue;
        }
        let [x0, y0, x1, y1] = piece.bounds;
        if (x1 - x0).max(y1 - y0) <= query.precision {
            range.include(Some([minimum, maximum]));
        } else {
            split(query, &piece, &mut pending)?;
        }
    }
    Ok(range.0)
}
fn sample_piece(
    query: &Query<'_>,
    sampler: &mut Adaptive<'_>,
    read: &dyn Fn(usize) -> io::Result<f64>,
    piece: &Piece,
    range: &mut Range,
) -> io::Result<()> {
    for point in traces(&piece.region).into_iter().flatten() {
        let [x, y, _] = point.coordinates();
        range.add(sampler.sample([x, y], read)?);
    }
    let b = piece.bounds;
    let middle = [(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0];
    if query
        .spatial
        .covers_points(&piece.region, &[Position::xy(middle[0], middle[1])])
        .map_err(io::Error::other)?[0]
    {
        range.add(sampler.sample(middle, read)?);
    }
    Ok(())
}
