//! Ordered traces use GEOS at existing station boundaries, preserving revisits and contacts.
use crate::geometry::NativeGeos;
use atlas_map::spatial::SpatialResult;
use atlas_map::{Geometry, Position};
use geos::{CoordSeq, Geom, Geometry as Native, Precision, PreparedGeometry};

fn line(coordinates: &[Position]) -> SpatialResult<Native> {
    if coordinates.len() < 2 {
        return Err("A trace needs at least two stations".into());
    }
    let dimensions = matches!(coordinates[0], Position::XYZ(_));
    let points: Vec<Vec<f64>> = coordinates
        .iter()
        .map(|p| {
            let xyz = p.coordinates();
            xyz[..if dimensions { 3 } else { 2 }].to_vec()
        })
        .collect();
    if !points.iter().flatten().all(|v| v.is_finite()) {
        return Err("Trace coordinates must be finite".into());
    }
    let sequence = CoordSeq::new_from_vec(&points).map_err(|e| e.to_string())?;
    Native::create_line_string(sequence).map_err(|e| e.to_string())
}

fn stations(value: Native) -> SpatialResult<Vec<Position>> {
    match NativeGeos::json(value)? {
        Some(Geometry::LineString { coordinates }) => Ok(coordinates),
        _ => Err("Trace resampling must retain a line".into()),
    }
}

pub(crate) fn resample(
    spatial: &NativeGeos,
    value: &Geometry,
    deviation: f64,
    spacing: Option<f64>,
) -> SpatialResult<Geometry> {
    let Geometry::LineString { coordinates } = value else {
        return Err("Trace resampling requires a LineString".into());
    };
    if !deviation.is_finite() || deviation < 0.0 {
        return Err("Trace deviation must be finite and nonnegative".into());
    }
    if spacing.is_some_and(|s| !s.is_finite() || s <= 0.0) {
        return Err("Trace spacing must be finite and positive".into());
    }
    let reduced = line(coordinates)?
        .simplify(deviation)
        .map_err(|e| e.to_string())?;
    let sampled = match spacing {
        Some(spacing) if reduced.get_length().map_err(|e| e.to_string())? > 0.0 => {
            reduced.densify(spacing).map_err(|e| e.to_string())?
        }
        _ => reduced,
    };
    let rounded = sampled
        .set_precision(spatial.precision, Precision::NoTopo)
        .map_err(|e| e.to_string())?;
    Ok(Geometry::LineString {
        coordinates: stations(rounded)?,
    })
}

fn pieces(value: Geometry, output: &mut Vec<Geometry>) {
    match value {
        Geometry::GeometryCollection { geometries } => {
            for part in geometries {
                pieces(part, output);
            }
        }
        Geometry::MultiLineString { coordinates } => {
            output.extend(
                coordinates
                    .into_iter()
                    .map(|coordinates| Geometry::LineString { coordinates }),
            );
        }
        Geometry::MultiPoint { coordinates } => {
            output.extend(
                coordinates
                    .into_iter()
                    .map(|coordinates| Geometry::Point { coordinates }),
            );
        }
        value @ (Geometry::Point { .. } | Geometry::LineString { .. }) => output.push(value),
        _ => {}
    }
}

fn project(line: &Native, position: Position) -> SpatialResult<f64> {
    let [x, y, _] = position.coordinates();
    let point = Native::create_point(CoordSeq::new_from_vec(&[[x, y]]).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    line.project(&point).map_err(|e| e.to_string())
}

fn ordered_intersection(
    line: &Native,
    mask: &Native,
    precision: f64,
) -> SpatialResult<Vec<Geometry>> {
    let result = line
        .intersection_prec(mask, precision)
        .map_err(|e| e.to_string())?;
    let mut parts = Vec::new();
    if let Some(result) = NativeGeos::json(result)? {
        pieces(result, &mut parts);
    }
    let mut ordered = Vec::new();
    for mut part in parts {
        let position = match &mut part {
            Geometry::Point { coordinates } => project(line, *coordinates)?,
            Geometry::LineString { coordinates } => {
                let start = project(line, coordinates[0])?;
                let end = project(line, *coordinates.last().expect("GEOS line has stations"))?;
                if start > end {
                    coordinates.reverse();
                }
                start.min(end)
            }
            _ => unreachable!("pieces only returns trace primitives"),
        };
        ordered.push((position, part));
    }
    ordered.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(ordered.into_iter().map(|(_, part)| part).collect())
}

fn clipped_parts(
    coordinates: &[Position],
    mask: &Native,
    prepared: &PreparedGeometry<'_>,
    precision: f64,
    output: &mut Vec<Geometry>,
) -> SpatialResult<()> {
    let input = line(coordinates)?;
    if prepared.covers(&input).map_err(|e| e.to_string())? {
        output.push(Geometry::LineString {
            coordinates: coordinates.to_vec(),
        });
        return Ok(());
    }
    if !prepared.intersects(&input).map_err(|e| e.to_string())? {
        return Ok(());
    }
    if coordinates.len() == 2 {
        output.extend(ordered_intersection(&input, mask, precision)?);
        return Ok(());
    }
    let middle = coordinates.len() / 2;
    clipped_parts(&coordinates[..=middle], mask, prepared, precision, output)?;
    clipped_parts(&coordinates[middle..], mask, prepared, precision, output)
}

pub(crate) fn clip(
    spatial: &NativeGeos,
    value: &Geometry,
    mask: &Geometry,
) -> SpatialResult<Option<Geometry>> {
    let lines: Vec<&[Position]> = match value {
        Geometry::LineString { coordinates } => vec![coordinates],
        Geometry::MultiLineString { coordinates } => {
            coordinates.iter().map(Vec::as_slice).collect()
        }
        _ => return Err("Trace clipping requires a LineString or MultiLineString".into()),
    };
    let mask = spatial.read(mask)?;
    let prepared = mask.to_prepared_geom().map_err(|e| e.to_string())?;
    let mut output = Vec::new();
    for coordinates in lines {
        let normalized = line(coordinates)?
            .set_precision(spatial.precision, Precision::NoTopo)
            .map_err(|e| e.to_string())?;
        clipped_parts(
            &stations(normalized)?,
            &mask,
            &prepared,
            spatial.precision,
            &mut output,
        )?;
    }
    combine(output)
}

fn combine(mut output: Vec<Geometry>) -> SpatialResult<Option<Geometry>> {
    if output.is_empty() {
        return Ok(None);
    }
    if output.len() == 1 {
        return Ok(output.pop());
    }
    if output
        .iter()
        .all(|p| matches!(p, Geometry::LineString { .. }))
    {
        let coordinates = output
            .into_iter()
            .map(|p| match p {
                Geometry::LineString { coordinates } => coordinates,
                _ => unreachable!(),
            })
            .collect();
        return Ok(Some(Geometry::MultiLineString { coordinates }));
    }
    Ok(Some(Geometry::GeometryCollection { geometries: output }))
}
