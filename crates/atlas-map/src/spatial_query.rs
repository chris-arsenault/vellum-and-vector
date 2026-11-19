use crate::{Geometry, Position};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// GIS operations on supplied map geometries. No rendering or generation policy.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub enum GeometryQuery {
    Intersection {
        geometry: Geometry,
        mask: Geometry,
    },
    Difference {
        geometry: Geometry,
        mask: Geometry,
    },
    Buffer {
        geometry: Geometry,
        distance: f64,
    },
    Interior {
        geometry: Geometry,
    },
    Intersects {
        geometry: Geometry,
        other: Geometry,
    },
    Covers {
        geometry: Geometry,
        points: Vec<Position>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum GeometryResult {
    Geometry(Option<Geometry>),
    Position(Position),
    Boolean(bool),
    Coverage(Vec<bool>),
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CoverageRequest {
    pub space_id: crate::Id,
    pub polygons: Vec<Geometry>,
    pub points: Vec<Position>,
}
