//! Snapped junctions: features attached to lines move with them. A bridge spans the water and
//! carries the way it lies across; a line whose end is snapped onto another line joins it.
use super::{
    shape_of,
    shapes::{transform_geometry, vertices},
    Shape, Transform,
};
use crate::{
    regions::point,
    spatial::{Overlay, Predicate, SpatialKernel, SpatialResult},
    Geometry, MapFeature, MapRelation, Position,
};

/// A crossing over water (a bridge) spans that line.
pub const SPANS: &str = "spans";
/// A crossing carries the way that runs over it.
pub const CARRIES: &str = "carries";
/// A line's end joins the line it was snapped onto.
pub const JOINS: &str = "joins";

pub fn is_junction(kind: &str) -> bool {
    matches!(kind, SPANS | CARRIES | JOINS)
}
/// Kinds that sit across the lines beneath them rather than beside them.
fn crossing(kind: &str) -> bool {
    kind == "bridge"
}
/// An outline that sits across the lines beneath it, such as a bridge.
pub fn crosses(feature: &MapFeature) -> bool {
    crossing(&feature.kind) && shape_of(&feature.layer_id) == Some(Shape::Area)
}
/// A wall: a line with a thickness in a structures layer.
fn is_wall(feature: &MapFeature) -> bool {
    super::shape_of_kind(&feature.layer_id, &feature.kind) == Some(Shape::Line)
        && super::family(&feature.layer_id) == "structures"
}
/// A feature's junctions as (line, kind) pairs, in a stable order.
pub fn junctions(feature: &MapFeature) -> Vec<(&str, &str)> {
    let mut pairs: Vec<_> = feature
        .relations
        .iter()
        .filter(|relation| is_junction(&relation.kind))
        .map(|relation| (relation.target_id.as_str(), relation.kind.as_str()))
        .collect();
    pairs.sort();
    pairs
}
/// How a crossing relates to a line of this layer.
fn crossed(layer_id: &str) -> Option<&'static str> {
    match layer_id.strip_prefix("vector:").unwrap_or(layer_id) {
        "rivers" | "waterworks" => Some(SPANS),
        "roads" => Some(CARRIES),
        _ => None,
    }
}

/// Replace a feature's junction relations with those its current shape makes with `lines`.
/// `tolerance` is how near a line's end must lie to another line to join it.
pub fn attach(
    feature: &mut MapFeature,
    lines: &[MapFeature],
    tolerance: f64,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<()> {
    feature
        .relations
        .retain(|relation| !is_junction(&relation.kind));
    let others = lines.iter().filter(|line| line.id != feature.id);
    if crosses(feature) {
        for line in others {
            let Some(kind) = crossed(&line.layer_id) else {
                continue;
            };
            if spatial.relation(&feature.geometry, &line.geometry, Predicate::Intersects)? {
                feature.relations.push(relation(line, kind));
            }
        }
        return Ok(());
    }
    // Ways and water join ways and water; a wall's end joins the wall it is drawn against.
    let wall = is_wall(feature);
    let Some(points) =
        vertices(&feature.geometry).filter(|_| wall || crossed(&feature.layer_id).is_some())
    else {
        return Ok(());
    };
    let ends = [points[0], points[points.len() - 1]];
    let joins = |line: &MapFeature| {
        if wall {
            is_wall(line)
        } else {
            crossed(&line.layer_id).is_some()
        }
    };
    for line in others.filter(|line| joins(line)) {
        for end in ends {
            if spatial.distance(&point(end), &line.geometry)? <= tolerance
                && !feature.relations.iter().any(|r| r.target_id == line.id)
            {
                feature.relations.push(relation(line, JOINS));
            }
        }
    }
    Ok(())
}
fn relation(line: &MapFeature, kind: &str) -> MapRelation {
    MapRelation {
        target_id: line.id.clone(),
        target_name: line.name.clone().unwrap_or_default(),
        kind: kind.into(),
    }
}

/// The dependent after the line it is attached to moved from `old` to `new`, or `None` when
/// it holds no junction with that line. `partner` is the other line a crossing holds (the way
/// a bridge carries when its water moved, and the reverse). A crossing that turns records the
/// turn in its `rotation`.
pub fn follow(
    dependent: &MapFeature,
    host: &str,
    old: &Geometry,
    new: &Geometry,
    partner: Option<&Geometry>,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Option<MapFeature>> {
    let Some(kind) = dependent
        .relations
        .iter()
        .find(|relation| relation.target_id == host && is_junction(&relation.kind))
        .map(|relation| relation.kind.as_str())
    else {
        return Ok(None);
    };
    let mut next = dependent.clone();
    if kind == JOINS {
        next.geometry = joined_end(dependent, old, new, spatial)?;
    } else {
        let (geometry, turned) = crossing_moved(dependent, kind, old, new, partner, spatial)?;
        next.geometry = geometry;
        super::plan::turn(&mut next, turned);
    }
    Ok(Some(next))
}
/// The end of a joined line that met the old host moves to the same place along the new one.
fn joined_end(
    dependent: &MapFeature,
    old: &Geometry,
    new: &Geometry,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Geometry> {
    let Some(points) = vertices(&dependent.geometry) else {
        return Ok(dependent.geometry.clone());
    };
    let last = points.len() - 1;
    let first_gap = spatial.distance(&point(points[0]), old)?;
    let last_gap = spatial.distance(&point(points[last]), old)?;
    let end = if first_gap <= last_gap { 0 } else { last };
    let fraction = spatial.line_fraction(old, points[end])?;
    let mut coordinates = points.to_vec();
    coordinates[end] = spatial.line_at(new, fraction)?;
    Ok(Geometry::LineString { coordinates })
}
/// A crossing stays where its two lines meet; with no meeting it keeps its place along the
/// moved line. It turns with the way it carries.
fn crossing_moved(
    dependent: &MapFeature,
    kind: &str,
    old: &Geometry,
    new: &Geometry,
    partner: Option<&Geometry>,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<(Geometry, f64)> {
    let anchor = centre(&dependent.geometry, spatial)?;
    let fraction = spatial.line_fraction(old, anchor)?;
    let along = spatial.line_at(new, fraction)?;
    let target = match partner {
        Some(partner) => nearest_meeting(new, partner, along, spatial)?.unwrap_or(along),
        None => along,
    };
    let rotate = if kind == CARRIES {
        let turn = heading(new, spatial.line_fraction(new, target)?, spatial)?
            - heading(old, fraction, spatial)?;
        // The shorter way round, so a line redrawn backwards does not flip its crossing.
        (turn + 180.0).rem_euclid(360.0) - 180.0
    } else {
        0.0
    };
    let ([ax, ay, _], [tx, ty, _]) = (anchor.coordinates(), target.coordinates());
    let geometry = transform_geometry(
        &dependent.geometry,
        &Transform {
            translate: [tx - ax, ty - ay],
            rotate,
            scale: 1.0,
            about: [ax, ay],
        },
    );
    Ok((geometry, rotate))
}
fn centre(geometry: &Geometry, spatial: &dyn SpatialKernel) -> SpatialResult<Position> {
    let crate::Bounds(w, s, e, n) = spatial.bounds(geometry)?;
    Ok(Position::xy((w + e) / 2.0, (s + n) / 2.0))
}
fn nearest_meeting(
    line: &Geometry,
    partner: &Geometry,
    near: Position,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Option<Position>> {
    let Some(meeting) = spatial.overlay(line, partner, Overlay::Intersection)? else {
        return Ok(None);
    };
    let [nx, ny, _] = near.coordinates();
    let mut points = Vec::new();
    collect_points(&meeting, &mut points);
    Ok(points.into_iter().min_by(|a, b| {
        let gap = |p: &Position| {
            let [x, y, _] = p.coordinates();
            (x - nx).hypot(y - ny)
        };
        gap(a).total_cmp(&gap(b))
    }))
}
fn collect_points(geometry: &Geometry, output: &mut Vec<Position>) {
    match geometry {
        Geometry::Point { coordinates } => output.push(*coordinates),
        Geometry::MultiPoint { coordinates } | Geometry::LineString { coordinates } => {
            output.extend(coordinates)
        }
        Geometry::GeometryCollection { geometries } => geometries
            .iter()
            .for_each(|part| collect_points(part, output)),
        _ => {}
    }
}
/// The line's direction in degrees at a fraction along it.
fn heading(line: &Geometry, fraction: f64, spatial: &dyn SpatialKernel) -> SpatialResult<f64> {
    let step = 1e-3;
    let a = spatial
        .line_at(line, (fraction - step).max(0.0))?
        .coordinates();
    let b = spatial
        .line_at(line, (fraction + step).min(1.0))?
        .coordinates();
    Ok((b[1] - a[1]).atan2(b[0] - a[0]).to_degrees())
}
