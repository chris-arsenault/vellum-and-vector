use super::{codec, interactions::as_region, reference_values, space, MapStore};
use crate::sql::column;
use atlas_map::{
    spatial::Predicate, Bounds, Geometry, MapRef, MapSample, MapSpace, Position, SampleWindow,
};
use std::io;

impl MapStore {
    pub fn samples_at(
        &self,
        reference: &MapRef,
        space_id: atlas_map::Id,
        position: Position,
    ) -> io::Result<Vec<MapSample>> {
        let map = self.open(reference)?;
        let space = space(&map, space_id)?;
        let position = canonical_position(space, position)?;
        let [x, y, _] = position.coordinates();
        let mut values = reference_values(reference);
        values.extend([space_id.into(), x.into(), x.into(), y.into(), y.into()]);
        let rows = self.db.query("SELECT s.data,s.geometry FROM map_samples s JOIN map_sample_bounds b ON b.row_id=s.row_id WHERE s.map_id=? AND s.revision=? AND s.space_id=? AND b.max_x>=? AND b.min_x<=? AND b.max_y>=? AND b.min_y<=? ORDER BY s.id", &values)?;
        let kernel = self.geometry.spatial(space.precision)?;
        let encoding = codec::Samples::new(&map);
        let point = Geometry::Point {
            coordinates: position,
        };
        let mut samples = Vec::new();
        for row in rows {
            let shape = self.geometry.decode(column(&row, "geometry")?.bytes()?)?;
            if !kernel
                .relation(&shape, &point, Predicate::Covers)
                .map_err(io::Error::other)?
            {
                continue;
            }
            let sample = encoding.decode(column(&row, "data")?.bytes()?, as_region(shape)?)?;
            if owns(&sample.window, space, position) {
                samples.push(sample);
            }
        }
        Ok(samples)
    }
}
pub(crate) fn canonical_position(space: &MapSpace, position: Position) -> io::Result<Position> {
    let [mut x, y, z] = position.coordinates();
    if ![x, y, z].iter().all(|v| v.is_finite()) {
        return Err(io::Error::other("Map position must be finite"));
    }
    if let Some(width) = space.periodic_width {
        x = space.bounds.0 + (x - space.bounds.0).rem_euclid(width);
    }
    Ok(match position {
        Position::XY(_) => Position::xy(x, y),
        Position::XYZ(_) => Position::XYZ([x, y, z]),
    })
}
pub(crate) fn owns(window: &SampleWindow, space: &MapSpace, position: Position) -> bool {
    let Bounds(w, s, e, n) = window.bounds;
    let [mut x, y, _] = position.coordinates();
    let round = |v: f64| (v + 0.5).floor();
    if let Some(width) = space.periodic_width {
        if x < w || x > e {
            x += round(((w + e) / 2.0 - x) / width) * width;
        }
    }
    let snap = |v: f64| round(v / space.precision);
    let within =
        |v: f64, low: f64, high: f64, closed| v >= low && if closed { v <= high } else { v < high };
    within(snap(x), snap(w), snap(e), window.closed_east)
        && within(snap(y), snap(s), snap(n), window.closed_north)
}
