//! A real-scale map's places at their true size and its numbered map key (ADR 0016).
use super::vectors::Vectors;
use crate::{features::Feature, field::poi::reads::first_coordinate};
use atlas_map::{hexes::HexGrid, Geometry, MapDescriptor, Position};
// hpc-exempt: a few hundred published place identities keyed to their key numbers.
use std::{collections::BTreeMap, io};

/// A place counts as standing on the map at its size once it is about this share of a hex
/// across; anything smaller stays a symbol.
pub const LEAST_HEX_SHARE: f64 = 0.75;
const OUTLINE_CORNERS: u32 = 24;

/// The outline a point place covers at its true size: an ellipse of its length east to west
/// and its width north to south, centred on the point, when it is about a hex across or more.
pub fn true_outline(
    centre: [f64; 2],
    length: f64,
    width: f64,
    across_flats: f64,
) -> Option<Geometry> {
    let (length, width) = (length.max(width), width.min(length));
    if !(length.is_finite() && width > 0.0) || length < LEAST_HEX_SHARE * across_flats {
        return None;
    }
    let [x, y] = centre;
    let mut ring: Vec<Position> = (0..OUTLINE_CORNERS)
        .map(|i| {
            let angle = f64::from(i) * std::f64::consts::TAU / f64::from(OUTLINE_CORNERS);
            Position::xy(
                x + length / 2.0 * angle.cos(),
                y + width / 2.0 * angle.sin(),
            )
        })
        .collect();
    ring.push(ring[0]);
    Some(Geometry::Polygon {
        coordinates: vec![ring],
    })
}
/// A point place's outline from its published `trueSize`.
pub fn sized_footprint(
    geometry: &Geometry,
    true_size: Option<&serde_json::Value>,
    across_flats: f64,
) -> Option<Geometry> {
    let (Geometry::Point { coordinates }, Some(size)) = (geometry, true_size) else {
        return None;
    };
    let part = |key: &str| size.get(key).and_then(serde_json::Value::as_f64);
    let (length, width) = match (part("length"), part("width")) {
        (Some(length), Some(width)) => (length, width),
        (Some(one), None) | (None, Some(one)) => (one, one),
        (None, None) => return None,
    };
    let [x, y, _] = coordinates.coordinates();
    true_outline([x, y], length, width, across_flats)
}
/// Key numbers in reading order: hex rows from the north, west to east along each row, so a
/// reader finds number 1 at the top left.
// hpc-exempt: published place identities keyed to their key numbers, not cell data.
pub fn key_numbers(
    places: &[(atlas_map::Id, [f64; 2])],
    grid: &HexGrid,
) -> BTreeMap<atlas_map::Id, u32> {
    let mut order: Vec<(i32, f64, atlas_map::Id)> = places
        .iter()
        .map(|&(id, point)| (-grid.hex_at(point).r, point[0], id))
        .collect();
    // hpc-exempt: reading order over a few hundred published places, not a cell ordering.
    order.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)).then(a.2.cmp(&b.2)));
    order
        .into_iter()
        .zip(1u32..)
        .map(|((_, _, id), number)| (id, number))
        .collect()
}
/// Where a published place stands for its key: its representative point, else its first
/// coordinate.
pub fn place_point(feature: &Feature) -> Option<[f64; 2]> {
    let given = feature
        .attributes
        .get("representative")
        .and_then(|point| Some([point.get("x")?.as_f64()?, point.get("y")?.as_f64()?]));
    given.or_else(|| {
        let [x, y, _] = first_coordinate(&feature.geometry)?.coordinates();
        Some([x, y])
    })
}
/// Every catalogue place on a real-scale map, numbered for its key. Other maps carry no key.
// hpc-exempt: published place identities keyed to their key numbers, not cell data.
pub fn map_key(
    vectors: &Vectors<'_>,
    map: &MapDescriptor,
) -> io::Result<BTreeMap<atlas_map::Id, u32>> {
    let Some(real) = &map.real_scale else {
        // hpc-exempt: an empty key for a map with no real scale.
        return Ok(BTreeMap::new());
    };
    let grid = real.grid().map_err(io::Error::other)?;
    let mut places = Vec::new();
    for layer in &map.layers {
        let Some(layer) = layer.id.strip_prefix("vector:") else {
            continue;
        };
        if layer == "hexes" {
            continue;
        }
        vectors
            .visit(layer, |feature| {
                if feature.attributes.contains_key("poi") {
                    if let Some(point) = place_point(&feature) {
                        places.push((feature.id, point));
                    }
                }
                Ok(())
            })
            .map_err(io::Error::other)?;
    }
    Ok(key_numbers(&places, &grid))
}
