use crate::spatial::{Overlay, Predicate, SpatialKernel, SpatialResult};
use crate::{Bounds, Geometry, MapSpace, Position, RegionGeometry};

pub fn as_geometry(value: &RegionGeometry) -> Geometry {
    match value {
        RegionGeometry::Polygon(coordinates) => Geometry::Polygon {
            coordinates: coordinates.clone(),
        },
        RegionGeometry::MultiPolygon(coordinates) => Geometry::MultiPolygon {
            coordinates: coordinates.clone(),
        },
    }
}
pub fn as_region(value: Geometry) -> SpatialResult<RegionGeometry> {
    match value {
        Geometry::Polygon { coordinates } => Ok(RegionGeometry::Polygon(coordinates)),
        Geometry::MultiPolygon { coordinates } => Ok(RegionGeometry::MultiPolygon(coordinates)),
        _ => Err("A region needs a closed polygonal outline".into()),
    }
}
pub fn point(position: Position) -> Geometry {
    Geometry::Point {
        coordinates: position,
    }
}
pub fn rectangle(Bounds(w, s, e, n): Bounds) -> Geometry {
    Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(w, s),
            Position::xy(e, s),
            Position::xy(e, n),
            Position::xy(w, n),
            Position::xy(w, s),
        ]],
    }
}
pub fn parts(shape: &Geometry) -> Vec<Geometry> {
    match shape {
        Geometry::Polygon { .. } => vec![shape.clone()],
        Geometry::MultiPolygon { coordinates } => coordinates
            .iter()
            .map(|coordinates| Geometry::Polygon {
                coordinates: coordinates.clone(),
            })
            .collect(),
        Geometry::GeometryCollection { geometries } => geometries.iter().flat_map(parts).collect(),
        _ => vec![],
    }
}
pub fn polygon(shape: Geometry) -> Option<Geometry> {
    match shape {
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => Some(shape),
        _ => {
            let coordinates: Vec<_> = parts(&shape)
                .into_iter()
                .filter_map(|part| match part {
                    Geometry::Polygon { coordinates } => Some(coordinates),
                    _ => None,
                })
                .collect();
            (!coordinates.is_empty()).then_some(Geometry::MultiPolygon { coordinates })
        }
    }
}
pub fn boundary_lines(shape: &Geometry) -> Vec<Vec<Position>> {
    match shape {
        Geometry::LineString { coordinates } => vec![coordinates.clone()],
        Geometry::MultiLineString { coordinates } | Geometry::Polygon { coordinates } => {
            coordinates.clone()
        }
        Geometry::MultiPolygon { coordinates } => coordinates.iter().flatten().cloned().collect(),
        Geometry::GeometryCollection { geometries } => {
            geometries.iter().flat_map(boundary_lines).collect()
        }
        _ => vec![],
    }
}
pub fn translate(shape: &Geometry, dx: f64) -> Geometry {
    fn shifted(p: &Position, dx: f64) -> Position {
        match p {
            Position::XY([x, y]) => Position::xy(x + dx, *y),
            Position::XYZ([x, y, z]) => Position::XYZ([x + dx, *y, *z]),
        }
    }
    let line = |points: &[Position]| points.iter().map(|p| shifted(p, dx)).collect();
    match shape {
        Geometry::Point { coordinates } => point(shifted(coordinates, dx)),
        Geometry::MultiPoint { coordinates } => Geometry::MultiPoint {
            coordinates: line(coordinates),
        },
        Geometry::LineString { coordinates } => Geometry::LineString {
            coordinates: line(coordinates),
        },
        Geometry::MultiLineString { coordinates } => Geometry::MultiLineString {
            coordinates: coordinates.iter().map(|ring| line(ring)).collect(),
        },
        Geometry::Polygon { coordinates } => Geometry::Polygon {
            coordinates: coordinates.iter().map(|ring| line(ring)).collect(),
        },
        Geometry::MultiPolygon { coordinates } => Geometry::MultiPolygon {
            coordinates: coordinates
                .iter()
                .map(|polygon| polygon.iter().map(|ring| line(ring)).collect())
                .collect(),
        },
        Geometry::GeometryCollection { geometries } => Geometry::GeometryCollection {
            geometries: geometries
                .iter()
                .map(|shape| translate(shape, dx))
                .collect(),
        },
    }
}

/// Join chart-edge fragments before choosing connected islands or dividing districts.
pub fn connected(
    space: &MapSpace,
    shape: &Geometry,
    position: Option<Position>,
    kernel: &dyn SpatialKernel,
) -> SpatialResult<Vec<Geometry>> {
    let (Some(width), Some(position)) = (space.periodic_width, position) else {
        return Ok(parts(shape));
    };
    let Bounds(w, s, e, n) = space.bounds;
    let bounds = kernel.bounds(shape)?;
    if (bounds.0 - w).abs() > space.precision || (bounds.2 - e).abs() > space.precision {
        return Ok(parts(shape));
    }
    let joined = kernel.union_all(&[
        shape.clone(),
        translate(shape, -width),
        translate(shape, width),
    ])?;
    let [x, _, _] = position.coordinates();
    let clipped = match joined {
        Some(joined) => kernel.overlay(
            &joined,
            &rectangle(Bounds(x - width / 2.0, s, x + width / 2.0, n)),
            Overlay::Intersection,
        )?,
        None => None,
    };
    Ok(clipped.as_ref().map(parts).unwrap_or_default())
}
pub fn canonical(
    space: &MapSpace,
    shape: &Geometry,
    kernel: &dyn SpatialKernel,
) -> SpatialResult<Geometry> {
    let Some(width) = space.periodic_width else {
        return kernel.canonical(shape);
    };
    let domain = rectangle(space.bounds);
    if kernel.relation(&domain, shape, Predicate::Covers)? {
        return kernel.canonical(shape);
    }
    let bounds = kernel.bounds(shape)?;
    let first = ((space.bounds.0 - bounds.2) / width).ceil() as i64;
    let last = ((space.bounds.2 - bounds.0) / width).floor() as i64;
    let mut shapes = Vec::new();
    for shift in first..=last {
        if let Some(clipped) = kernel
            .overlay(
                &translate(shape, shift as f64 * width),
                &domain,
                Overlay::Intersection,
            )?
            .and_then(polygon)
        {
            shapes.push(clipped);
        }
    }
    let result = kernel
        .union_all(&shapes)?
        .ok_or("Region is outside its coordinate space")?;
    kernel.canonical(&result)
}
