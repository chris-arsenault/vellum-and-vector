//! Coordinate conversion avoids the GEOS 3.11 GeoJSON reader's XY-only format.
use atlas_map::{Geometry, Polygon, Position};
use geos::{CoordSeq, CoordType, GResult, Geom, Geometry as Native, GeometryTypes};

fn sequence(points: &[Position]) -> GResult<CoordSeq> {
    let xyz = points.iter().any(|p| matches!(p, Position::XYZ(_)));
    let kind = if xyz { CoordType::XYZ } else { CoordType::XY };
    let mut result = CoordSeq::new(points.len() as u32, kind)?;
    for (i, point) in points.iter().enumerate() {
        let [x, y, z] = point.coordinates();
        if ![x, y, z].iter().all(|v| v.is_finite()) {
            return Err(geos::Error::GenericError(
                "Coordinates must be finite".into(),
            ));
        }
        result.set_x(i, x)?;
        result.set_y(i, y)?;
        if xyz {
            result.set_z(i, z)?;
        }
    }
    Ok(result)
}
fn polygon(rings: &Polygon) -> GResult<Native> {
    let Some((exterior, interiors)) = rings.split_first() else {
        return Native::create_empty_polygon();
    };
    let ring = |points: &Vec<Position>| Native::create_linear_ring(sequence(points)?);
    Native::create_polygon(
        ring(exterior)?,
        interiors.iter().map(ring).collect::<GResult<_>>()?,
    )
}
pub(super) fn read(value: &Geometry) -> GResult<Native> {
    match value {
        Geometry::Point { coordinates } => Native::create_point(sequence(&[*coordinates])?),
        Geometry::LineString { coordinates } => Native::create_line_string(sequence(coordinates)?),
        Geometry::Polygon { coordinates } => polygon(coordinates),
        Geometry::MultiPoint { coordinates } => Native::create_multipoint(
            coordinates
                .iter()
                .map(|p| Native::create_point(sequence(&[*p])?))
                .collect::<GResult<_>>()?,
        ),
        Geometry::MultiLineString { coordinates } => Native::create_multiline_string(
            coordinates
                .iter()
                .map(|p| Native::create_line_string(sequence(p)?))
                .collect::<GResult<_>>()?,
        ),
        Geometry::MultiPolygon { coordinates } => {
            Native::create_multipolygon(coordinates.iter().map(polygon).collect::<GResult<_>>()?)
        }
        Geometry::GeometryCollection { geometries } => {
            Native::create_geometry_collection(geometries.iter().map(read).collect::<GResult<_>>()?)
        }
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
