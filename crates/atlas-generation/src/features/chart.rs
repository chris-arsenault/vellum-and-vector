use crate::spatial::{Overlay, Predicate, SpatialKernel, SpatialResult};
use atlas_map::{regions::translate, Bounds, Geometry, Position};

/// The captured world reference supplies the authoritative domain, including its seam.
pub struct Chart<'a> {
    pub domain: &'a Geometry,
    pub bounds: Bounds,
    pub cylindrical: bool,
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Dimension {
    Point,
    Line,
    Polygon,
}
impl Chart<'_> {
    pub fn copies(
        &self,
        geometry: &Geometry,
        spatial: &dyn SpatialKernel,
    ) -> SpatialResult<Vec<Geometry>> {
        if !self.cylindrical {
            return Ok(vec![geometry.clone()]);
        }
        let width = self.bounds.2 - self.bounds.0;
        let Bounds(low, _, high, _) = spatial.bounds(geometry)?;
        let first = ((self.bounds.0 - high) / width).ceil() as i64;
        let last = ((self.bounds.2 - low) / width).floor() as i64;
        Ok((first..=last)
            .map(|shift| translate(geometry, shift as f64 * width))
            .collect())
    }
    pub fn compact_bounds(
        &self,
        geometry: &Geometry,
        spatial: &dyn SpatialKernel,
    ) -> SpatialResult<Bounds> {
        let bounds = spatial.bounds(geometry)?;
        if !self.cylindrical {
            return Ok(bounds);
        }
        let mut polygons = Vec::new();
        parts(geometry.clone(), Dimension::Polygon, &mut polygons);
        let mut intervals = polygons
            .iter()
            .map(|p| spatial.bounds(p))
            .collect::<SpatialResult<Vec<_>>>()?;
        if intervals.is_empty() {
            return Ok(bounds);
        }
        // hpc-exempt: polygon chart pieces, not a cell-indexed geographic search.
        intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
        let width = self.bounds.2 - self.bounds.0;
        let mut end = intervals[0].2;
        let mut gap = intervals[0].0 + width - intervals.last().unwrap().2;
        let mut start = intervals[0].0;
        for interval in &intervals[1..] {
            if interval.0 - end > gap {
                gap = interval.0 - end;
                start = interval.0;
            }
            end = end.max(interval.2);
        }
        Ok(Bounds(
            start,
            bounds.1,
            start + width - gap.max(0.0),
            bounds.3,
        ))
    }
    pub fn position(&self, position: Position) -> Position {
        if !self.cylindrical {
            return position;
        }
        let Bounds(west, _, east, _) = self.bounds;
        let width = east - west;
        let wrap = |x: f64| west + ((x - west) % width + width) % width;
        match position {
            Position::XY([x, y]) => Position::XY([wrap(x), y]),
            Position::XYZ([x, y, z]) => Position::XYZ([wrap(x), y, z]),
        }
    }
    pub fn geometry(
        &self,
        geometry: &Geometry,
        spatial: &dyn SpatialKernel,
    ) -> SpatialResult<Geometry> {
        if !self.cylindrical
            || spatial.canonical(geometry).is_err()
            || spatial.relation(self.domain, geometry, Predicate::Covers)?
        {
            return Ok(geometry.clone());
        }
        if let Geometry::Point { coordinates } = geometry {
            return Ok(Geometry::Point {
                coordinates: self.position(*coordinates),
            });
        }
        let dimension = match geometry {
            Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => Dimension::Polygon,
            Geometry::LineString { .. } | Geometry::MultiLineString { .. } => Dimension::Line,
            _ => Dimension::Point,
        };
        let Bounds(west, _, east, _) = self.bounds;
        let width = east - west;
        let Bounds(low, _, high, _) = spatial.bounds(geometry)?;
        let first = ((west - high) / width).ceil() as i64;
        let last = ((east - low) / width).floor() as i64;
        let mut shapes = Vec::new();
        for shift in first..=last {
            let copy = translate(geometry, shift as f64 * width);
            let clip = match copy {
                Geometry::LineString { .. } | Geometry::MultiLineString { .. } => {
                    spatial.clip_trace(&copy, self.domain)?
                }
                _ => spatial.overlay(&copy, self.domain, Overlay::Intersection)?,
            };
            if let Some(shape) = clip {
                parts(shape, dimension, &mut shapes);
            }
        }
        combine(shapes, dimension, geometry, spatial)
    }
}
fn dimension(geometry: &Geometry) -> Dimension {
    match geometry {
        Geometry::GeometryCollection { geometries } => geometries
            .iter()
            .map(dimension)
            .max()
            .unwrap_or(Dimension::Point),
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => Dimension::Polygon,
        Geometry::LineString { .. } | Geometry::MultiLineString { .. } => Dimension::Line,
        _ => Dimension::Point,
    }
}
/// Place canonical geometry in a continuous working chart without clipping outside shapes.
pub fn working(
    geometry: &Geometry,
    bounds: Bounds,
    width: Option<f64>,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Geometry> {
    let Some(width) = width.filter(|&w| w > 0.0) else {
        return Ok(geometry.clone());
    };
    let extent = spatial.bounds(geometry)?;
    if extent.0 >= bounds.0 && extent.1 >= bounds.1 && extent.2 <= bounds.2 && extent.3 <= bounds.3
    {
        return Ok(geometry.clone());
    }
    let dim = dimension(geometry);
    let mut simple = Vec::new();
    parts(geometry.clone(), dim, &mut simple);
    let mut copies = Vec::new();
    for shape in simple {
        let Bounds(west, _, east, _) = spatial.bounds(&shape)?;
        let first = ((bounds.0 - east) / width).ceil() as i64;
        let last = ((bounds.2 - west) / width).floor() as i64;
        let mut shifts = (first..=last)
            .filter(|&shift| {
                west == east
                    || (east + shift as f64 * width > bounds.0
                        && west + shift as f64 * width < bounds.2)
            })
            .collect::<Vec<_>>();
        if shifts.is_empty() {
            shifts.push((((bounds.0 + bounds.2 - west - east) / 2.0) / width + 0.5).floor() as i64);
        }
        copies.extend(
            shifts
                .into_iter()
                .map(|shift| translate(&shape, shift as f64 * width)),
        );
    }
    combine(copies, dim, geometry, spatial)
}
fn parts(shape: Geometry, dimension: Dimension, output: &mut Vec<Geometry>) {
    match shape {
        Geometry::GeometryCollection { geometries } => {
            for shape in geometries {
                parts(shape, dimension, output);
            }
        }
        Geometry::MultiLineString { coordinates } if dimension == Dimension::Line => {
            output.extend(
                coordinates
                    .into_iter()
                    .map(|coordinates| Geometry::LineString { coordinates }),
            );
        }
        Geometry::MultiPolygon { coordinates } if dimension == Dimension::Polygon => {
            output.extend(
                coordinates
                    .into_iter()
                    .map(|coordinates| Geometry::Polygon { coordinates }),
            );
        }
        Geometry::MultiPoint { coordinates } if dimension == Dimension::Point => {
            output.extend(
                coordinates
                    .into_iter()
                    .map(|coordinates| Geometry::Point { coordinates }),
            );
        }
        Geometry::LineString { .. } if dimension == Dimension::Line => output.push(shape),
        Geometry::Polygon { .. } if dimension == Dimension::Polygon => output.push(shape),
        Geometry::Point { .. } if dimension == Dimension::Point => output.push(shape),
        _ => {}
    }
}
fn combine(
    mut shapes: Vec<Geometry>,
    dimension: Dimension,
    original: &Geometry,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Geometry> {
    if shapes.is_empty() {
        return Ok(original.clone());
    }
    if shapes.len() == 1 {
        return Ok(shapes.remove(0));
    }
    match dimension {
        Dimension::Polygon => spatial
            .union_all(&shapes)?
            .ok_or("Clipped polygons failed to combine".into()),
        Dimension::Line => Ok(Geometry::MultiLineString {
            coordinates: shapes
                .into_iter()
                .filter_map(|s| {
                    if let Geometry::LineString { coordinates } = s {
                        Some(coordinates)
                    } else {
                        None
                    }
                })
                .collect(),
        }),
        Dimension::Point => Ok(Geometry::MultiPoint {
            coordinates: shapes
                .into_iter()
                .filter_map(|s| {
                    if let Geometry::Point { coordinates } = s {
                        Some(coordinates)
                    } else {
                        None
                    }
                })
                .collect(),
        }),
    }
}
