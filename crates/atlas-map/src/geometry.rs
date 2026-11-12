use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub type Ring = Vec<Position>;
pub type Polygon = Vec<Ring>;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct Position(pub f64, pub f64);

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct Bounds(pub f64, pub f64, pub f64, pub f64);

/// The atlas uses planar metres; map navigation does not change this frame implicitly.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapSpace {
    pub id: String,
    pub bounds: Bounds,
    pub metres_per_unit: f64,
    pub periodic_width: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "coordinates")]
pub enum Geometry {
    Point(Position),
    MultiPoint(Vec<Position>),
    LineString(Vec<Position>),
    MultiLineString(Vec<Vec<Position>>),
    Polygon(Vec<Vec<Position>>),
    MultiPolygon(Vec<Vec<Vec<Position>>>),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "coordinates")]
pub enum RegionGeometry {
    Polygon(Vec<Vec<Position>>),
    MultiPolygon(Vec<Vec<Vec<Position>>>),
}
