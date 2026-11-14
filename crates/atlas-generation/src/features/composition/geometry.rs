use crate::spatial::{SpatialKernel, SpatialResult};
use atlas_map::Geometry;

pub fn dimension(shape: &Geometry) -> u8 {
    match shape {
        Geometry::GeometryCollection { geometries } => {
            geometries.iter().map(dimension).max().unwrap_or(0)
        }
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => 2,
        Geometry::LineString { .. } | Geometry::MultiLineString { .. } => 1,
        _ => 0,
    }
}
fn parts(shape: Geometry, output: &mut Vec<Geometry>) {
    match shape {
        Geometry::GeometryCollection { geometries } => {
            for shape in geometries {
                parts(shape, output);
            }
        }
        Geometry::MultiPolygon { coordinates } => output.extend(
            coordinates
                .into_iter()
                .map(|coordinates| Geometry::Polygon { coordinates }),
        ),
        Geometry::MultiLineString { coordinates } => output.extend(
            coordinates
                .into_iter()
                .map(|coordinates| Geometry::LineString { coordinates }),
        ),
        Geometry::MultiPoint { coordinates } => output.extend(
            coordinates
                .into_iter()
                .map(|coordinates| Geometry::Point { coordinates }),
        ),
        shape => output.push(shape),
    }
}
pub fn combine(
    shapes: Vec<Geometry>,
    dim: u8,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Option<Geometry>> {
    let mut matching = Vec::new();
    for shape in shapes {
        parts(shape, &mut matching);
    }
    matching.retain(|shape| dimension(shape) == dim);
    if matching.len() <= 1 {
        return Ok(matching.pop());
    }
    Ok(Some(match dim {
        2 => return spatial.union_all(&matching),
        1 => Geometry::MultiLineString {
            coordinates: matching
                .into_iter()
                .filter_map(|shape| match shape {
                    Geometry::LineString { coordinates } => Some(coordinates),
                    _ => None,
                })
                .collect(),
        },
        _ => Geometry::MultiPoint {
            coordinates: matching
                .into_iter()
                .filter_map(|shape| match shape {
                    Geometry::Point { coordinates } => Some(coordinates),
                    _ => None,
                })
                .collect(),
        },
    }))
}
