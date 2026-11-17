//! Where a building stands against its street, and the address that gives it. Shared by the
//! town tools that place a building and by the store's renumbering of every street an edit
//! touches, so both apply the one odd-left, even-right rule (`crate::town::numbers`).
use super::{family, shapes::vertices};
use crate::{
    spatial::{SpatialKernel, SpatialResult},
    town::{address, numbers_around, Side},
    Geometry, MapFeature, MapRelation, Position,
};
use serde_json::Value;

/// How far from a street a building may stand and still front it, in metres.
pub const FRONTAGE_REACH: f64 = 40.0;
/// A building's relation to the street it fronts.
pub const FRONTS: &str = "fronts";
/// The attributes an address writes on the building and plot that hold it.
pub const ADDRESS_KEYS: [&str; 4] = ["address", "addressNumber", "street", "streetId"];

/// A way: a line in the roads layer (street, road, track or trail).
pub fn is_way(feature: &MapFeature) -> bool {
    family(&feature.layer_id) == "roads" && matches!(feature.geometry, Geometry::LineString { .. })
}
/// A named settlement street, which buildings front and take their numbers from.
pub fn is_street(feature: &MapFeature) -> bool {
    is_way(feature) && feature.kind == "street"
}
pub fn is_building(feature: &MapFeature) -> bool {
    family(&feature.layer_id) == "structures" && feature.kind == "building"
}
pub fn is_yard(feature: &MapFeature) -> bool {
    family(&feature.layer_id) == "plots" && feature.kind == "yard"
}
/// Buildings and their plots carry the address of the street they front.
pub fn holds_address(feature: &MapFeature) -> bool {
    is_building(feature) || is_yard(feature)
}
/// The street a building or plot is numbered on.
pub fn street_of(feature: &MapFeature) -> Option<&str> {
    feature.attributes.get("streetId").and_then(Value::as_str)
}

/// A point's place against a street: metres along it from its first point, which side it is
/// on, the street's nearest point and direction there, and half the street's width there.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frontage {
    pub along: f64,
    pub side: Side,
    pub point: [f64; 2],
    pub direction: [f64; 2],
    pub half_width: f64,
}
pub fn frontage(
    street: &MapFeature,
    at: Position,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Frontage> {
    let line = &street.geometry;
    let fraction = spatial.line_fraction(line, at)?;
    let [px, py, _] = spatial.line_at(line, fraction)?.coordinates();
    let direction = direction(line, fraction, spatial)?;
    let [ax, ay, _] = at.coordinates();
    let cross = direction[0] * (ay - py) - direction[1] * (ax - px);
    Ok(Frontage {
        along: fraction * spatial.length(line)?,
        side: if cross >= 0.0 {
            Side::Left
        } else {
            Side::Right
        },
        point: [px, py],
        direction,
        half_width: width_at(street, fraction, spatial)? / 2.0,
    })
}
/// The street's unit direction at a fraction along it.
pub fn direction(
    line: &Geometry,
    fraction: f64,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<[f64; 2]> {
    let step = 1e-4;
    let a = spatial
        .line_at(line, (fraction - step).max(0.0))?
        .coordinates();
    let b = spatial
        .line_at(line, (fraction + step).min(1.0))?
        .coordinates();
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length = dx.hypot(dy);
    Ok(if length > 0.0 {
        [dx / length, dy / length]
    } else {
        [1.0, 0.0]
    })
}
/// A line's width at a fraction along it, from its widths per vertex; no widths read as none.
pub fn width_at(
    line: &MapFeature,
    fraction: f64,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<f64> {
    let Some(points) = vertices(&line.geometry) else {
        return Ok(0.0);
    };
    let Some(widths) = widths(line).filter(|w| w.len() == points.len()) else {
        return Ok(0.0);
    };
    let fractions = spatial.line_fractions(&line.geometry, points)?;
    Ok(super::shapes::interpolate(&fractions, &widths, fraction))
}
fn widths(feature: &MapFeature) -> Option<Vec<f64>> {
    feature
        .attributes
        .get("widths")?
        .as_array()?
        .iter()
        .map(Value::as_f64)
        .collect()
}
/// House numbers for plots standing at these points along a street.
/// Plots holding a `fixed` number (on a locked layer) keep it and the rest avoid it.
pub fn renumber(
    street: &MapFeature,
    anchors: &[Position],
    fixed: &[Option<u32>],
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Vec<u32>> {
    let placed = anchors
        .iter()
        .map(|at| frontage(street, *at, spatial).map(|f| (f.along, f.side)))
        .collect::<SpatialResult<Vec<_>>>()?;
    Ok(numbers_around(&placed, fixed))
}
/// A building or plot with the address of `street` at `number`, or with no address when it
/// fronts no street. A plot named by its address line is renamed with it.
pub fn readdress(holder: &MapFeature, street: Option<(&MapFeature, u32)>) -> MapFeature {
    let mut next = holder.clone();
    next.relations.retain(|relation| relation.kind != FRONTS);
    let Some((street, number)) = street else {
        for key in ADDRESS_KEYS {
            next.attributes.remove(key);
        }
        return next;
    };
    let name = street
        .name
        .clone()
        .unwrap_or_else(|| "Unnamed street".into());
    let line = address(number, &name);
    for (key, value) in [
        ("address", Value::from(line.clone())),
        ("addressNumber", number.into()),
        ("street", name.clone().into()),
        ("streetId", street.id.clone().into()),
    ] {
        next.attributes.insert(key.into(), value);
    }
    if is_building(holder) {
        next.relations.push(MapRelation {
            target_id: street.id.clone(),
            target_name: name,
            kind: FRONTS.into(),
        });
    }
    let labelled = holder.attributes.get("nameStatus").and_then(Value::as_str) == Some("label");
    if is_yard(holder) && (labelled || holder.name.is_none()) {
        next.name = Some(line);
    }
    next
}
/// The way with a vertex at `fraction` along it, so a street joining there meets it at a
/// shared point; the vertex takes the width the way has there. A junction on an existing
/// vertex leaves the way as it is. Returns the way and the junction point.
pub fn insert_junction(
    way: &MapFeature,
    fraction: f64,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<(MapFeature, Position)> {
    let Some(points) = vertices(&way.geometry) else {
        return Err("A junction joins a line".into());
    };
    let at = spatial.line_at(&way.geometry, fraction)?;
    let [x, y, _] = at.coordinates();
    let near = |p: &Position| {
        let [px, py, _] = p.coordinates();
        (px - x).hypot(py - y) < 1e-3
    };
    if let Some(existing) = points.iter().find(|p| near(p)) {
        return Ok((way.clone(), *existing));
    }
    let fractions = spatial.line_fractions(&way.geometry, points)?;
    let index = fractions
        .iter()
        .position(|f| *f > fraction)
        .unwrap_or(points.len() - 1)
        .clamp(1, points.len() - 1);
    let mut next = way.clone();
    let mut coordinates = points.to_vec();
    coordinates.insert(index, at);
    next.geometry = Geometry::LineString { coordinates };
    if let Some(mut widths) = widths(way).filter(|w| w.len() == points.len()) {
        let width = super::shapes::interpolate(&fractions, &widths, fraction);
        widths.insert(index, (width * 1000.0).round() / 1000.0);
        next.attributes.insert("widths".into(), widths.into());
    }
    Ok((next, at))
}
