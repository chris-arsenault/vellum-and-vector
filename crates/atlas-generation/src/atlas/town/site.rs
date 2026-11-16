//! What the real-scale map holds for its settlements: the frame, the ground on its triangles,
//! the captured settlement records and the ways that enter the frame.
use super::{
    geometry::{add, angle, at, cut, distance, left, line_length, rest, scale, sub, unit, Point},
    ground::{Ground, OUTSIDE, STEEP, WATER},
    network::{Arm, VERTEX_STEP},
    plan::Seat,
    story::Story,
};
use crate::{
    atlas::state::State,
    features::{Feature, FeatureReader, FeatureSelection},
    field::{poi::reads::has_channel, refinement::courses::cell_at, shared::Scalar, Field},
    human::{catalogue::LayerId, HumanField},
    lattice::Membership,
    rock::ground::GroundField,
    spatial::SpatialKernel,
};
use atlas_map::{Geometry, Position};
use serde_json::Value;
use std::io;

/// Slope (rise over run) beyond which nobody builds or ploughs.
const STEEP_SLOPE: f64 = 0.35;
/// The plan's grid cell: fine enough for town plots, coarser only on very wide maps.
const FINEST_CELL: f64 = 1.5;
const MOST_CELLS_ACROSS: f64 = 1_600.0;

pub struct Site {
    pub bounds: [f64; 4],
    pub ground: Ground,
    pub seats: Vec<Seat>,
}
pub fn bounds(state: &State) -> io::Result<[f64; 4]> {
    let atlas_map::Bounds(w, s, e, n) = state
        .spatial
        .bounds(&state.scope.footprint)
        .map_err(io::Error::other)?;
    Ok([w, s, e, n])
}
pub fn read(state: &State) -> io::Result<Site> {
    let bounds = bounds(state)?;
    let ground = ground(state.field(), bounds)?;
    let roads = roads(state.records.features.as_ref(), &state.scope.area)?;
    let seats = seats(state, bounds, &roads, &ground)?;
    Ok(Site {
        bounds,
        ground,
        seats,
    })
}
/// Water and steep ground per triangle.
fn marks(field: &Field) -> io::Result<Vec<u32>> {
    let slope = field.shared().scalar(Scalar::Slope);
    let kind = field.water().column.kind;
    (0..field.mesh().len())
        .map(|cell| {
            Ok(if kind.get(cell)? != 0 || has_channel(field, cell)? {
                WATER
            } else if slope.get(cell)? > STEEP_SLOPE {
                STEEP
            } else {
                0
            })
        })
        .collect()
}
fn ground(field: &Field, bounds: [f64; 4]) -> io::Result<Ground> {
    let side = (bounds[2] - bounds[0]).max(bounds[3] - bounds[1]);
    let mut ground = Ground::new(bounds, (side / MOST_CELLS_ACROSS).max(FINEST_CELL));
    let marks = marks(field)?;
    let mesh = field.mesh();
    let origin = mesh.origin();
    for index in 0..ground.count() {
        let p = ground.centre(index);
        if p[0] > bounds[2] || p[1] > bounds[3] {
            ground.withhold(index, OUTSIDE);
        } else if let Some(cell) = cell_at(mesh, p) {
            ground.withhold(index, marks[cell]);
        }
    }
    for (cell, &mark) in marks.iter().enumerate() {
        let [x, y] = mesh.position(cell);
        if mark != 0 && mesh.membership(cell) == Membership::Content {
            if let Some(index) = ground.index([x + origin[0], y + origin[1]]) {
                ground.withhold(index, mark);
            }
        }
    }
    Ok(ground)
}
/// A way captured from the parent: its lines on this map and the places its label names.
pub struct Road {
    pub lines: Vec<Vec<Point>>,
    pub ends: Vec<String>,
    pub strategic: bool,
}
fn lines(geometry: &Geometry) -> Vec<Vec<Point>> {
    let points = |line: &[Position]| {
        line.iter()
            .map(|p| {
                let [x, y, _] = p.coordinates();
                [x, y]
            })
            .collect()
    };
    match geometry {
        Geometry::LineString { coordinates } => vec![points(coordinates)],
        Geometry::MultiLineString { coordinates } => {
            coordinates.iter().map(|l| points(l)).collect()
        }
        _ => Vec::new(),
    }
}
fn roads(features: &dyn FeatureReader, area: &str) -> io::Result<Vec<Road>> {
    let mut result = Vec::new();
    for kind in ["road", "trail"] {
        for feature in features.values(FeatureSelection {
            area_id: Some(area),
            layer_id: Some("roads"),
            kind: Some(kind),
        })? {
            let feature = feature?;
            if feature.attributes.get("wayKind").and_then(Value::as_str) == Some("sea") {
                continue;
            }
            result.push(Road {
                lines: lines(&feature.geometry),
                ends: feature
                    .name
                    .split('–')
                    .map(|s| s.trim().to_owned())
                    .collect(),
                strategic: feature.attributes.get("strategic").and_then(Value::as_bool)
                    == Some(true),
            });
        }
    }
    Ok(result)
}
fn number(attributes: &crate::features::records::Attributes, key: &str) -> Option<f64> {
    let value = attributes.get(key)?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse().ok())
}
fn text<'a>(feature: &'a Feature, key: &str) -> Option<&'a str> {
    feature.attributes.get(key).and_then(Value::as_str)
}
fn seats(
    state: &State,
    bounds: [f64; 4],
    roads: &[Road],
    ground: &Ground,
) -> io::Result<Vec<Seat>> {
    let mut seats = Vec::new();
    for feature in state.records.features.values(FeatureSelection {
        area_id: Some(&state.scope.area),
        layer_id: Some("settlements"),
        kind: Some("settlement"),
    })? {
        let feature = feature?;
        let Geometry::Point { coordinates } = &feature.geometry else {
            continue;
        };
        let [x, y, _] = coordinates.coordinates();
        let inside = (bounds[0]..=bounds[2]).contains(&x) && (bounds[1]..=bounds[3]).contains(&y);
        if !inside || text(&feature, "status") == Some("abandoned") {
            continue;
        }
        seats.push(seat(state, &feature, [x, y], roads, ground, bounds)?);
    }
    // hpc-exempt: orders the frame's few settlements, largest first.
    seats.sort_by(|a, b| b.story.people.total_cmp(&a.story.people));
    Ok(seats)
}
fn seat(
    state: &State,
    feature: &Feature,
    centre: Point,
    roads: &[Road],
    ground: &Ground,
    bounds: [f64; 4],
) -> io::Result<Seat> {
    let meeting = Meeting {
        centre,
        reach: 500.0_f64.max(0.25 * (bounds[2] - bounds[0]).max(bounds[3] - bounds[1])),
        name: &feature.name,
    };
    let mut arms = Vec::new();
    let mut guarded = feature.attributes.get("fortress").and_then(Value::as_bool) == Some(true);
    for road in roads {
        let before = arms.len();
        for line in &road.lines {
            arms_of(
                state.spatial.as_ref(),
                line,
                &road.ends,
                &meeting,
                &mut arms,
            )?;
        }
        guarded |= road.strategic && arms.len() > before;
    }
    if arms.is_empty() {
        arms = contour_arms(state.field(), centre, ground, bounds)?;
    }
    let story = story(feature, arms.len(), guarded);
    Ok(Seat {
        key: feature.id.clone(),
        name: feature.name.clone(),
        centre,
        story,
        arms,
        culture: text(feature, "namingCulture").map(str::to_owned),
    })
}
fn story(feature: &Feature, ways: usize, guarded: bool) -> Story {
    let attributes = &feature.attributes;
    let site = text(feature, "siteKind").unwrap_or_default();
    let history = attributes
        .get("history")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Story {
        people: number(attributes, "settlementPopulation")
            .or_else(|| number(attributes, "population"))
            .unwrap_or(0.0),
        seat: matches!(
            text(feature, "settlementRole"),
            Some("capital" | "regionalCapital")
        ),
        guarded,
        ways,
        waterside: matches!(site, "river" | "river mouth" | "harbour")
            || number(attributes, "riverOrder").is_some_and(|o| o > 0.0)
            || attributes.get("coastal").and_then(Value::as_bool) == Some(true),
        pass: site == "pass",
        upland: site == "upland",
        town_eras: history
            .iter()
            .filter(|h| {
                h.get("townsfolk")
                    .and_then(Value::as_f64)
                    .is_some_and(|t| t > 0.0)
            })
            .count(),
        eras: history.len(),
    }
}
/// A settlement meeting the ways: its centre, how far off a way may pass and still be its
/// way in, and its name, which a way's label names at one end.
struct Meeting<'a> {
    centre: Point,
    reach: f64,
    name: &'a str,
}
/// The arms a captured way gives a settlement: from the centre to the way's nearest point and
/// on along it each way, each named for the place its label puts at that end.
fn arms_of(
    spatial: &dyn SpatialKernel,
    line: &[Point],
    ends: &[String],
    meeting: &Meeting<'_>,
    arms: &mut Vec<Arm>,
) -> io::Result<()> {
    let (centre, reach, name) = (meeting.centre, meeting.reach, meeting.name);
    if line.len() < 2 {
        return Ok(());
    }
    let geometry = Geometry::LineString {
        coordinates: line.iter().map(|p| Position::xy(p[0], p[1])).collect(),
    };
    let fraction = spatial
        .line_fraction(&geometry, Position::xy(centre[0], centre[1]))
        .map_err(io::Error::other)?;
    let along = fraction * line_length(line);
    let Some((meeting, _)) = at(line, along) else {
        return Ok(());
    };
    if distance(meeting, centre) > reach {
        return Ok(());
    }
    let destination = |end: usize| {
        (ends.len() == 2 && ends[end] != name && !ends[end].is_empty()).then(|| ends[end].clone())
    };
    let mut back = cut(line, along);
    back.reverse();
    for (part, end) in [(back, 0), (rest(line, along), 1)] {
        if line_length(&part) < 2.0 * VERTEX_STEP {
            continue;
        }
        let mut points = vec![centre];
        points.extend(part.into_iter().filter(|p| distance(*p, centre) > 1e-6));
        add_arm(
            arms,
            Arm {
                points,
                destination: destination(end),
            },
        );
    }
    Ok(())
}
fn heading_of(arm: &Arm) -> f64 {
    let probe =
        at(&arm.points, 100.0_f64.min(line_length(&arm.points))).map_or(arm.points[0], |(p, _)| p);
    angle(sub(probe, arm.points[0]))
}
/// Adds an arm unless one already leaves the centre the same way.
fn add_arm(arms: &mut Vec<Arm>, arm: Arm) {
    let heading = heading_of(&arm);
    let same = arms.iter_mut().find(|other| {
        let gap = (heading_of(other) - heading).rem_euclid(std::f64::consts::TAU);
        gap.min(std::f64::consts::TAU - gap) < 0.25
    });
    match same {
        Some(other) => {
            if other.destination.is_none() {
                other.destination = arm.destination;
            }
        }
        None => arms.push(arm),
    }
}
fn elevation(field: &Field, p: Point) -> io::Result<f64> {
    let ground = field.ground();
    let view = ground.view(GroundField::Elevation);
    cell_at(field.mesh(), p).map_or(Ok(0.0), |cell| view.get(cell))
}
/// With no way in, a place strings out along the contour through its centre.
fn contour_arms(
    field: &Field,
    centre: Point,
    ground: &Ground,
    bounds: [f64; 4],
) -> io::Result<Vec<Arm>> {
    let probe = 4.0 * ground.cell;
    let dx =
        elevation(field, add(centre, [probe, 0.0]))? - elevation(field, sub(centre, [probe, 0.0]))?;
    let dy =
        elevation(field, add(centre, [0.0, probe]))? - elevation(field, sub(centre, [0.0, probe]))?;
    let along = if dx.hypot(dy) > 1e-9 {
        left(unit([dx, dy]))
    } else {
        [1.0, 0.0]
    };
    let length = (bounds[2] - bounds[0]).hypot(bounds[3] - bounds[1]);
    Ok([1.0, -1.0]
        .into_iter()
        .map(|sign| Arm {
            points: vec![centre, add(centre, scale(along, sign * length))],
            destination: None,
        })
        .collect())
}
/// The farmland and pasture shares of the triangle under a point.
pub fn shares(field: &Field, p: Point) -> io::Result<(f64, f64)> {
    let Some(cell) = cell_at(field.mesh(), p) else {
        return Ok((0.0, 0.0));
    };
    let people = field.people();
    Ok((
        people
            .view(HumanField::Layer(LayerId::Farmland))
            .get(cell)?,
        people.view(HumanField::Layer(LayerId::Pasture)).get(cell)?,
    ))
}
/// Square metres the map's people farm and graze, by their shares on its triangles.
pub fn farmed(field: &Field) -> io::Result<f64> {
    let people = field.people();
    let farmland = people.view(HumanField::Layer(LayerId::Farmland));
    let pasture = people.view(HumanField::Layer(LayerId::Pasture));
    (0..field.mesh().len()).try_fold(0.0, |sum, cell| {
        Ok(sum + (farmland.get(cell)? + pasture.get(cell)?) * field.mesh().content_area(cell))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn arm(to: Point, destination: Option<&str>) -> Arm {
        Arm {
            points: vec![[0.0, 0.0], to],
            destination: destination.map(str::to_owned),
        }
    }
    #[test]
    fn ways_leaving_the_same_way_become_one_main_street() {
        let mut arms = Vec::new();
        add_arm(&mut arms, arm([500.0, 0.0], None));
        add_arm(&mut arms, arm([500.0, 20.0], Some("Elder Ford")));
        add_arm(&mut arms, arm([-500.0, 0.0], Some("Kell")));
        assert_eq!(arms.len(), 2);
        assert_eq!(arms[0].destination.as_deref(), Some("Elder Ford"));
        assert_eq!(arms[1].destination.as_deref(), Some("Kell"));
    }
}
