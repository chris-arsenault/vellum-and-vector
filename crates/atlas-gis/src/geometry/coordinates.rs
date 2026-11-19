//! Coordinate conversion avoids the GEOS 3.11 GeoJSON reader's XY-only format.
use atlas_map::{Geometry, Polygon, Position};
use geos::{CoordSeq, CoordType, GResult, Geom, Geometry as Native, GeometryTypes};

/// A value rounded to the grid with GEOS's arithmetic: a grid finer than one unit rounds by
/// its whole-number scale, so a value already on the grid stays exactly as it is.
fn on_grid(value: f64, grid: f64) -> f64 {
    let round = |v: f64| (v + 0.5).floor();
    if grid > 1. {
        return round(value / grid) * grid;
    }
    let scale = 1. / grid;
    let whole = scale.round();
    let scale = if (scale - whole).abs() < 1e-6 {
        whole
    } else {
        scale
    };
    round(value * scale) / scale
}
/// Horizontal coordinates are rounded to the grid when one is given, as GEOS rounds them.
fn sequence(points: &[Position], grid: Option<f64>) -> GResult<CoordSeq> {
    let xyz = points.iter().any(|p| matches!(p, Position::XYZ(_)));
    let kind = if xyz { CoordType::XYZ } else { CoordType::XY };
    let round = |v: f64| grid.map_or(v, |g| on_grid(v, g));
    let mut result = CoordSeq::new(points.len() as u32, kind)?;
    for (i, point) in points.iter().enumerate() {
        let [x, y, z] = point.coordinates();
        if ![x, y, z].iter().all(|v| v.is_finite()) {
            return Err(geos::Error::GenericError(
                "Coordinates must be finite".into(),
            ));
        }
        result.set_x(i, round(x))?;
        result.set_y(i, round(y))?;
        if xyz {
            result.set_z(i, z)?;
        }
    }
    Ok(result)
}
fn polygon(rings: &Polygon, grid: Option<f64>) -> GResult<Native> {
    let Some((exterior, interiors)) = rings.split_first() else {
        return Native::create_empty_polygon();
    };
    let ring = |points: &Vec<Position>| Native::create_linear_ring(sequence(points, grid)?);
    Native::create_polygon(
        ring(exterior)?,
        interiors.iter().map(ring).collect::<GResult<_>>()?,
    )
}
pub(super) fn read(value: &Geometry) -> GResult<Native> {
    read_on(value, None)
}
/// The geometry with each coordinate rounded to the grid; it may be invalid or collapsed.
pub(super) fn read_on_grid(value: &Geometry, grid: f64) -> GResult<Native> {
    read_on(value, Some(grid))
}
fn read_on(value: &Geometry, grid: Option<f64>) -> GResult<Native> {
    let line = |points: &[Position]| Native::create_line_string(sequence(points, grid)?);
    let point = |p: &Position| Native::create_point(sequence(std::slice::from_ref(p), grid)?);
    match value {
        Geometry::Point { coordinates } => point(coordinates),
        Geometry::LineString { coordinates } => line(coordinates),
        Geometry::Polygon { coordinates } => polygon(coordinates, grid),
        Geometry::MultiPoint { coordinates } => {
            Native::create_multipoint(coordinates.iter().map(point).collect::<GResult<_>>()?)
        }
        Geometry::MultiLineString { coordinates } => Native::create_multiline_string(
            coordinates
                .iter()
                .map(|p| line(p))
                .collect::<GResult<_>>()?,
        ),
        Geometry::MultiPolygon { coordinates } => Native::create_multipolygon(
            coordinates
                .iter()
                .map(|p| polygon(p, grid))
                .collect::<GResult<_>>()?,
        ),
        Geometry::GeometryCollection { geometries } => Native::create_geometry_collection(
            geometries
                .iter()
                .map(|g| read_on(g, grid))
                .collect::<GResult<_>>()?,
        ),
    }
}
fn points(value: &impl Geom) -> GResult<Vec<Position>> {
    let sequence = value.get_coord_seq()?;
    let xyz = value.has_z()?;
    (0..sequence.size()?)
        .map(|i| {
            let x = sequence.get_x(i)?;
            let y = sequence.get_y(i)?;
            if xyz {
                let z = sequence.get_z(i)?;
                if z.is_finite() {
                    return Ok(Position::XYZ([x, y, z]));
                }
            }
            Ok(Position::xy(x, y))
        })
        .collect()
}
fn rings(value: &impl Geom) -> GResult<Polygon> {
    let mut result = vec![points(&value.get_exterior_ring()?)?];
    for i in 0..value.get_num_interior_rings()? {
        result.push(points(&value.get_interior_ring_n(i)?)?);
    }
    Ok(result)
}
pub(super) fn write(value: &impl Geom) -> GResult<Geometry> {
    Ok(match value.geometry_type()? {
        GeometryTypes::Point => Geometry::Point {
            coordinates: points(value)?[0],
        },
        GeometryTypes::LineString | GeometryTypes::LinearRing => Geometry::LineString {
            coordinates: points(value)?,
        },
        GeometryTypes::Polygon => Geometry::Polygon {
            coordinates: rings(value)?,
        },
        GeometryTypes::MultiPoint => Geometry::MultiPoint {
            coordinates: (0..value.get_num_geometries()?)
                .map(|i| Ok(points(&value.get_geometry_n(i)?)?[0]))
                .collect::<GResult<_>>()?,
        },
        GeometryTypes::MultiLineString => Geometry::MultiLineString {
            coordinates: (0..value.get_num_geometries()?)
                .map(|i| points(&value.get_geometry_n(i)?))
                .collect::<GResult<_>>()?,
        },
        GeometryTypes::MultiPolygon => Geometry::MultiPolygon {
            coordinates: (0..value.get_num_geometries()?)
                .map(|i| rings(&value.get_geometry_n(i)?))
                .collect::<GResult<_>>()?,
        },
        GeometryTypes::GeometryCollection => Geometry::GeometryCollection {
            geometries: (0..value.get_num_geometries()?)
                .map(|i| write(&value.get_geometry_n(i)?))
                .collect::<GResult<_>>()?,
        },
    })
}
