use crate::map_store::{space, MapAccess};
use atlas_map::{
    spatial::{Overlay, Predicate, SpatialKernel, SpatialResult},
    CoverageRequest, Geometry, GeometryQuery, GeometryResult, MapRef,
};
use std::io;

pub fn query(
    maps: &dyn MapAccess,
    reference: &MapRef,
    space_id: &str,
    queries: &[GeometryQuery],
) -> io::Result<Vec<GeometryResult>> {
    let map = maps.open(reference)?;
    let spatial = maps.geometry().spatial(space(&map, space_id)?.precision)?;
    queries
        .iter()
        .map(|q| evaluate(spatial.as_ref(), q).map_err(io::Error::other))
        .collect()
}

fn evaluate(spatial: &dyn SpatialKernel, query: &GeometryQuery) -> SpatialResult<GeometryResult> {
    use GeometryQuery as Q;
    use GeometryResult as R;
    Ok(match query {
        Q::Intersection { geometry, mask } => {
            R::Geometry(spatial.overlay(geometry, mask, Overlay::Intersection)?)
        }
        Q::Difference { geometry, mask } => {
            R::Geometry(spatial.overlay(geometry, mask, Overlay::Difference)?)
        }
        Q::Buffer { geometry, distance } => {
            if !distance.is_finite() {
                return Err("Buffer distance must be finite".into());
            }
            R::Geometry(spatial.buffer(geometry, *distance)?)
        }
        Q::Interior { geometry } => R::Position(spatial.interior_position(geometry)?),
        Q::Intersects { geometry, other } => {
            R::Boolean(spatial.relation(geometry, other, Predicate::Intersects)?)
        }
        Q::Covers { geometry, points } => R::Coverage(spatial.covers_points(geometry, points)?),
    })
}

pub fn coverage(
    maps: &dyn MapAccess,
    reference: &MapRef,
    request: CoverageRequest,
) -> io::Result<Vec<Vec<bool>>> {
    let map = maps.open(reference)?;
    let spatial = maps
        .geometry()
        .spatial(space(&map, &request.space_id)?.precision)?;
    request
        .polygons
        .iter()
        .map(|polygon| {
            spatial
                .covers_points(polygon, &request.points)
                .map_err(io::Error::other)
        })
        .collect()
}

pub fn areas(
    maps: &dyn MapAccess,
    reference: &MapRef,
    space_id: &str,
    shapes: &[Geometry],
) -> io::Result<Vec<f64>> {
    let map = maps.open(reference)?;
    let space = space(&map, space_id)?;
    let spatial = maps.geometry().spatial(space.precision)?;
    shapes
        .iter()
        .map(|shape| {
            spatial
                .area(shape)
                .map(|area| area * space.metres_per_unit.powi(2))
                .map_err(io::Error::other)
        })
        .collect()
}
