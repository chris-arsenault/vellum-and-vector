use super::geometry::Point;
use atlas_map::{Geometry, Position};
pub fn line(points: &[Point]) -> Geometry {
    Geometry::LineString {
        coordinates: points.iter().map(|p| Position::xy(p[0], p[1])).collect(),
    }
}
