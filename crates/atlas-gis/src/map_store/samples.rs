use super::{interactions::as_region, reference_values, space, MapStore};
use crate::{rows::SampleRow, sql::column};
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
        let rows = self.db.query("SELECT s.* FROM map_samples s JOIN map_sample_bounds b ON b.row_id=s.row_id WHERE s.map_id=? AND s.revision=? AND s.space_id=? AND b.max_x>=? AND b.min_x<=? AND b.max_y>=? AND b.min_y<=? ORDER BY s.id", &values)?;
        let kernel = self.geometry.spatial(space.precision)?;
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
            let sample = sample_row(&row)?.sample(as_region(shape)?)?;
            if owns(&sample.window, space, position) {
                samples.push(sample);
            }
        }
        Ok(samples)
    }
}
fn sample_row(row: &crate::sql::Row) -> io::Result<SampleRow> {
    let real = |name: &str| column(row, name)?.real();
    Ok(SampleRow {
        id: column(row, "id")?.text()?.to_owned(),
        space_id: column(row, "space_id")?.id()?,
        window: Bounds(
            real("window_west")?,
            real("window_south")?,
            real("window_east")?,
            real("window_north")?,
        ),
        closed_east: column(row, "closed_east")?.flag()?,
        closed_north: column(row, "closed_north")?.flag()?,
        cell_span: real("cell_span")?,
        center: [real("center_x")?, real("center_y")?],
        center_z: column(row, "center_z")?.optional_real()?,
        measure: real("measure")?,
        active: column(row, "active")?.flag()?,
        sections: column(row, "sections")?
            .optional_text()?
            .map(|text| serde_json::from_str(&text))
            .transpose()?,
    })
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
