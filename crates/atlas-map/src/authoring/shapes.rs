//! Shape changes under a kept feature identity: affine transforms, widths carried along a
//! reshaped line, and the footprint a widened line covers.
use super::Transform;
use crate::{
    regions::as_region,
    spatial::{SpatialKernel, SpatialResult},
    Geometry, MapFeature, Position, RegionGeometry,
};

/// Rotate and scale every vertex about `about`, then translate.
pub fn transform_geometry(geometry: &Geometry, transform: &Transform) -> Geometry {
    let (sin, cos) = transform.rotate.to_radians().sin_cos();
    let [ax, ay] = transform.about;
    let [tx, ty] = transform.translate;
    let moved = |position: Position| {
        let [x, y, z] = position.coordinates();
        let (dx, dy) = ((x - ax) * transform.scale, (y - ay) * transform.scale);
        let (x, y) = (ax + dx * cos - dy * sin + tx, ay + dx * sin + dy * cos + ty);
        match position {
            Position::XY(_) => Position::xy(x, y),
            Position::XYZ(_) => Position::XYZ([x, y, z]),
        }
    };
    map_positions(geometry, &moved)
}
fn map_positions(geometry: &Geometry, moved: &impl Fn(Position) -> Position) -> Geometry {
    let line = |points: &Vec<Position>| points.iter().copied().map(moved).collect::<Vec<_>>();
    let rings = |rings: &Vec<Vec<Position>>| rings.iter().map(line).collect::<Vec<_>>();
    match geometry {
        Geometry::Point { coordinates } => Geometry::Point {
            coordinates: moved(*coordinates),
        },
        Geometry::MultiPoint { coordinates } => Geometry::MultiPoint {
            coordinates: line(coordinates),
        },
        Geometry::LineString { coordinates } => Geometry::LineString {
            coordinates: line(coordinates),
        },
        Geometry::MultiLineString { coordinates } => Geometry::MultiLineString {
            coordinates: rings(coordinates),
        },
        Geometry::Polygon { coordinates } => Geometry::Polygon {
            coordinates: rings(coordinates),
        },
        Geometry::MultiPolygon { coordinates } => Geometry::MultiPolygon {
            coordinates: coordinates.iter().map(rings).collect(),
        },
        Geometry::GeometryCollection { geometries } => Geometry::GeometryCollection {
            geometries: geometries
                .iter()
                .map(|part| map_positions(part, moved))
                .collect(),
        },
    }
}
pub(super) fn vertices(geometry: &Geometry) -> Option<&[Position]> {
    match geometry {
        Geometry::LineString { coordinates } => Some(coordinates),
        _ => None,
    }
}

/// Widths for a line's new vertices. A vertex that kept its place, or the same vertex count
/// after a drag, keeps its width; an inserted vertex takes the width where it lies along the
/// old line, found by linear reference.
pub fn carry_widths(
    old: &Geometry,
    widths: &[f64],
    new: &Geometry,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Vec<f64>> {
    let (Some(before), Some(after)) = (vertices(old), vertices(new)) else {
        return Err("Widths follow a line's vertices".into());
    };
    if widths.len() != before.len() {
        return Err("A line's widths must match its vertices".into());
    }
    if after.len() == before.len() {
        return Ok(widths.to_vec());
    }
    let known = spatial.line_fractions(old, before)?;
    let placed = spatial.line_fractions(old, after)?;
    Ok(after
        .iter()
        .zip(placed)
        .map(
            |(point, fraction)| match before.iter().position(|old| old == point) {
                Some(index) => widths[index],
                None => interpolate(&known, widths, fraction),
            },
        )
        .collect())
}
/// A source line's widths read at the fractions of another line's own vertices.
pub fn widths_at(
    source: &Geometry,
    widths: &[f64],
    target: &Geometry,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Vec<f64>> {
    let (Some(from), Some(to)) = (vertices(source), vertices(target)) else {
        return Err("Widths follow a line's vertices".into());
    };
    if widths.len() != from.len() {
        return Err("A line's widths must match its vertices".into());
    }
    let known = spatial.line_fractions(source, from)?;
    let wanted = spatial.line_fractions(target, to)?;
    Ok(wanted
        .into_iter()
        .map(|fraction| interpolate(&known, widths, fraction))
        .collect())
}
pub(super) fn interpolate(fractions: &[f64], widths: &[f64], fraction: f64) -> f64 {
    for k in 1..fractions.len() {
        if fraction <= fractions[k] {
            let span = fractions[k] - fractions[k - 1];
            let t = if span > 0.0 {
                ((fraction - fractions[k - 1]) / span).clamp(0.0, 1.0)
            } else {
                0.0
            };
            return widths[k - 1] + (widths[k] - widths[k - 1]) * t;
        }
    }
    widths.last().copied().unwrap_or(1.0)
}
/// The ground a feature covers: a widened line's outline, else nothing beyond its geometry.
pub fn footprint(
    feature: &MapFeature,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Option<RegionGeometry>> {
    crate::hexes::widened_footprint(&feature.geometry, feature.attributes.get("widths"), spatial)?
        .map(as_region)
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn points(geometry: &Geometry) -> Vec<[f64; 2]> {
        vertices(geometry)
            .unwrap()
            .iter()
            .map(|p| {
                let [x, y, _] = p.coordinates();
                [(x * 1e9).round() / 1e9, (y * 1e9).round() / 1e9]
            })
            .collect()
    }
    fn line(points: &[[f64; 2]]) -> Geometry {
        Geometry::LineString {
            coordinates: points.iter().map(|&[x, y]| Position::xy(x, y)).collect(),
        }
    }

    #[test]
    fn transforms_rotate_and_scale_about_a_point_then_translate() {
        let shape = line(&[[1.0, 0.0], [2.0, 0.0]]);
        let turned = transform_geometry(
            &shape,
            &Transform {
                translate: [10.0, 0.0],
                rotate: 90.0,
                scale: 2.0,
                about: [0.0, 0.0],
            },
        );
        assert_eq!(points(&turned), [[10.0, 2.0], [10.0, 4.0]]);
    }
    #[test]
    fn transforms_keep_heights_and_every_ring() {
        let shape = Geometry::Polygon {
            coordinates: vec![vec![
                Position::XYZ([0.0, 0.0, 5.0]),
                Position::XYZ([1.0, 0.0, 5.0]),
                Position::XYZ([0.0, 1.0, 5.0]),
                Position::XYZ([0.0, 0.0, 5.0]),
            ]],
        };
        let moved = transform_geometry(
            &shape,
            &Transform {
                translate: [1.0, 1.0],
                rotate: 0.0,
                scale: 1.0,
                about: [0.0, 0.0],
            },
        );
        let Geometry::Polygon { coordinates } = moved else {
            panic!("an outline stays an outline")
        };
        assert_eq!(coordinates[0][1], Position::XYZ([2.0, 1.0, 5.0]));
    }
}
