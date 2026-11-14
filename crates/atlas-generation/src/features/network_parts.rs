//! Split named courses at existing junctions while retaining per-vertex profiles.
use super::{chart::Chart, records::Attributes, Feature};
use atlas_map::{Geometry, Position};
use std::{collections::BTreeSet, io};

pub struct Part {
    pub coordinates: Vec<Position>,
    pub attributes: Attributes,
}
pub fn line_parts(geometry: &Geometry) -> Vec<&[Position]> {
    match geometry {
        Geometry::LineString { coordinates } => vec![coordinates],
        Geometry::MultiLineString { coordinates } => {
            coordinates.iter().map(Vec::as_slice).collect()
        }
        Geometry::GeometryCollection { geometries } => {
            geometries.iter().flat_map(line_parts).collect()
        }
        _ => Vec::new(),
    }
}
fn key(chart: &Chart<'_>, point: Position) -> String {
    let [x, y, _] = chart.position(point).coordinates();
    let clean = |v| if v == 0.0 { 0.0 } else { v };
    format!("{:.6}:{:.6}", clean(x), clean(y))
}
fn has_length(coordinates: &[Position], precision: f64) -> bool {
    let Some(first) = coordinates.first() else {
        return false;
    };
    let [x, y, _] = first.coordinates();
    let at = |value: f64| (value / precision + 0.5).floor();
    coordinates.iter().any(|p| {
        let [px, py, _] = p.coordinates();
        at(px) != at(x) || at(py) != at(y)
    })
}
fn junctions(feature: &Feature, chart: &Chart<'_>) -> io::Result<BTreeSet<String>> {
    let mut found = BTreeSet::new();
    if let Some(points) = feature
        .attributes
        .get("junctions")
        .and_then(|v| v.as_array())
    {
        for point in points {
            let coordinates = point
                .as_array()
                .ok_or_else(|| io::Error::other("Junction must be a coordinate"))?;
            let number = |at| {
                coordinates
                    .get(at)
                    .and_then(serde_json::Value::as_f64)
                    .ok_or_else(|| io::Error::other("Junction needs two numeric coordinates"))
            };
            found.insert(key(chart, Position::xy(number(0)?, number(1)?)));
        }
    }
    Ok(found)
}
pub fn parts(feature: &Feature, chart: &Chart<'_>, precision: f64) -> io::Result<Vec<Part>> {
    let junctions = junctions(feature, chart)?;
    let lines = line_parts(&feature.geometry);
    let vertices: usize = lines.iter().map(|line| line.len()).sum();
    let mut before = 0;
    let mut parts = Vec::new();
    for line in lines {
        let offset = before;
        before += line.len();
        if line.is_empty() {
            continue;
        }
        let mut cuts = vec![0];
        cuts.extend(
            line.iter()
                .enumerate()
                .filter(|(at, point)| {
                    *at > 0 && *at + 1 < line.len() && junctions.contains(&key(chart, **point))
                })
                .map(|(at, _)| at),
        );
        cuts.push(line.len() - 1);
        for ends in cuts.windows(2) {
            let [start, end] = [ends[0], ends[1]];
            let coordinates = &line[start..=end];
            if !has_length(coordinates, precision) {
                continue;
            }
            let mut attributes = feature.attributes.clone();
            for (name, value) in &mut attributes {
                if name == "junctions" {
                    continue;
                }
                if let Some(values) = value.as_array_mut() {
                    if values.len() == vertices {
                        *values = values[offset + start..=offset + end].to_vec();
                    }
                }
            }
            if let Some(first) = attributes
                .get("discharges")
                .and_then(|v| v.as_array())
                .and_then(|v| v.first())
                .cloned()
            {
                attributes.insert("discharge".into(), first);
            }
            parts.push(Part {
                coordinates: coordinates.to_vec(),
                attributes,
            });
        }
    }
    Ok(parts)
}
