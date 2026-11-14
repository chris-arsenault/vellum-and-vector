use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub type Ring = Vec<Position>;
pub type Polygon = Vec<Ring>;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum Position {
    XY([f64; 2]),
    XYZ([f64; 3]),
}
impl Position {
    pub fn xy(x: f64, y: f64) -> Self {
        Self::XY([x, y])
    }
    pub fn coordinates(self) -> [f64; 3] {
        match self {
            Self::XY([x, y]) => [x, y, 0.0],
            Self::XYZ(xyz) => xyz,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct Bounds(pub f64, pub f64, pub f64, pub f64);

/// The atlas uses planar metres; map navigation does not change this frame implicitly.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapSpace {
    pub id: String,
    pub parent_space_id: Option<String>,
    pub bounds: Bounds,
    pub metres_per_unit: f64,
    pub precision: f64,
    pub periodic_width: Option<f64>,
    pub frame: MapFrame,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapFrame {
    pub origin: [f64; 3],
    pub rotation: f64,
    pub floor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
pub enum Geometry {
    Point {
        coordinates: Position,
    },
    MultiPoint {
        coordinates: Vec<Position>,
    },
    LineString {
        coordinates: Vec<Position>,
    },
    MultiLineString {
        coordinates: Vec<Vec<Position>>,
    },
    Polygon {
        coordinates: Vec<Vec<Position>>,
    },
    MultiPolygon {
        coordinates: Vec<Vec<Vec<Position>>>,
    },
    GeometryCollection {
        geometries: Vec<Geometry>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "coordinates")]
pub enum RegionGeometry {
    Polygon(Vec<Vec<Position>>),
    MultiPolygon(Vec<Vec<Vec<Position>>>),
}
