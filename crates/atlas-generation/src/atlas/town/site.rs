//! What the real-scale map holds for its settlements: the frame, the ground on its triangles,
//! the captured settlement records and the ways that enter the frame.
use super::{
    geometry::{angle, at, cut, distance, line_length, rest, sub, Point},
    ground::{Ground, FREE, OUTSIDE, STEEP, WATER},
    network::{vertex_step, Arm},
    seat::Seat,
    story::Story,
};
use crate::{
    atlas::state::State,
    features::{Feature, FeatureReader, FeatureSelection},
    field::{refinement::courses::cell_at, shared::Scalar, Field},
    human::{catalogue::LayerId, HumanField},
    rock::ground::GroundField,
    spatial::SpatialKernel,
};
use atlas_map::{Geometry, Id, Position};
use serde_json::Value;
use std::io;

use super::settings::{FINEST_CELL, MOST_CELLS_ACROSS, STEEP_SLOPE, UNSTATED_WAY_WIDTH, WALL_LINE};
use crate::town::scale::{Measure, TownScale};
/// How far a captured settlement's ways may pass from it and still enter it, at least. Street
/// metres, resolved by `Measure::Layout`.
const MEETING_REACH: f64 = 500.;
/// How far along an arm its heading is read. Street metres, resolved by `Measure::Layout`.
const HEADING_PROBE: f64 = 100.;

pub struct Site {
    pub bounds: [f64; 4],
    pub ground: Ground,
    pub seats: Vec<Seat>,
    /// Every way on the map (captured roads, tracks and trails) with its widest width.
    pub ways: Vec<(Vec<Point>, f64)>,
}
pub fn bounds(state: &State) -> io::Result<[f64; 4]> {
    let atlas_map::Bounds(w, s, e, n) = state
        .spatial
        .bounds(&state.scope.footprint)
        .map_err(io::Error::other)?;
    Ok([w, s, e, n])
}
pub fn read(state: &State) -> io::Result<Site> {
    read_from(
        state,
        state.records.features.as_ref(),
        Some(state.scope.area),
    )
}
/// Captured context is available before refinement republishes the working GIS records.
pub fn starting(state: &State) -> io::Result<Site> {
    match state.records.source_features.as_deref() {
        Some(source) => read_from(state, source, None),
        None => read(state),
    }
}
fn read_from(state: &State, features: &dyn FeatureReader, area: Option<Id>) -> io::Result<Site> {
    let bounds = bounds(state)?;
    let ground = terrain(state, bounds)?;
    let roads = roads(features, area)?;
    let seats = seats(state, features, area, bounds, &roads, &ground)?;
    Ok(Site {
        bounds,
        ground,
        seats,
        ways: ways(features, area, state.town.scale())?,
    })
}
/// The map's terrain on the town ground, its cells and walls sized at the map's town scale.
fn terrain(state: &State, bounds: [f64; 4]) -> io::Result<Ground> {
    let scale = state.town.scale();
    let mut ground = ground(state.field(), bounds, scale)?;
    let current = state.records.features.as_ref();
    let area = Some(state.scope.area);
    let water = drawn_water(current, area, state.spatial.as_ref())?;
    ground.mark_shapes(&water, WATER, state.spatial.as_ref())?;
    fortifications(current, area, &mut ground, state.spatial.as_ref(), scale)?;
    Ok(ground)
}
/// The map's terrain with the towns' walls taken, and on a city map the city's walls: the
/// base the town steps mark buildings on.
pub(super) fn walled_terrain(state: &State) -> io::Result<Ground> {
    let mut ground = terrain(state, bounds(state)?)?;
    let line = state.town.scale().length(WALL_LINE, Measure::Width);
    for wall in state.town.towns.iter().flat_map(|town| town.kernel_walls()) {
        ground.take_line(wall, line, crate::town::ground::WALL);
    }
    for face in crate::atlas::regional::city::wall_lines(state)? {
        ground.take_line(&face, line, crate::town::ground::WALL);
    }
    Ok(ground)
}
/// A fingerprint of what the walled terrain reads: the field's version, the map's footprint,
/// the drawn water and recorded fortifications, and the towns' walls.
pub(super) fn terrain_key(state: &State) -> io::Result<u64> {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    state.field_version().hash(&mut hasher);
    // The ground's cells and walls are sized at the map's town scale.
    (state.town.scale().fidelity() as u8).hash(&mut hasher);
    state.scope.footprint.fingerprint().hash(&mut hasher);
    let area = Some(state.scope.area);
    let features = state.records.features.as_ref();
    for (layer, kind) in [
        ("rivers", None),
        ("lakes", None),
        ("structures", Some("wall")),
        ("structures", Some("gate")),
    ] {
        for feature in features.values(FeatureSelection {
            area_id: area,
            layer_id: Some(layer),
            kind,
        })? {
            let feature = feature?;
            feature.id.hash(&mut hasher);
            feature.geometry.fingerprint().hash(&mut hasher);
            feature
                .footprint
                .as_ref()
                .map(Geometry::fingerprint)
                .hash(&mut hasher);
            // Channel widths and lake levels shape the drawn water.
            for (key, value) in &feature.attributes {
                key.hash(&mut hasher);
                hash_value(value, &mut hasher);
            }
        }
    }
    for wall in state.town.towns.iter().flat_map(|town| town.kernel_walls()) {
        for [x, y] in wall {
            (x.to_bits(), y.to_bits()).hash(&mut hasher);
        }
    }
    // A city's walls stand once raised; a new one changes their count.
    if let Some(regional) = state.regional.as_ref() {
        for wall in &regional.city.walls {
            (wall.round, wall.inside.len()).hash(&mut hasher);
        }
    }
    Ok(hasher.finish())
}
/// An open attribute value hashed by its contents: numbers by their bits.
fn hash_value(value: &Value, hasher: &mut impl std::hash::Hasher) {
    use std::hash::Hash;
    std::mem::discriminant(value).hash(hasher);
    match value {
        Value::Null => {}
        Value::Bool(b) => b.hash(hasher),
        Value::Number(n) => n.as_f64().map(f64::to_bits).hash(hasher),
        Value::String(s) => s.hash(hasher),
        Value::Array(items) => {
            items.len().hash(hasher);
            items.iter().for_each(|v| hash_value(v, hasher));
        }
        Value::Object(map) => {
            map.len().hash(hasher);
            for (key, v) in map {
                key.hash(hasher);
                hash_value(v, hasher);
            }
        }
    }
}
/// Every town's buildings standing on the ground surface.
pub(super) fn ground_buildings(state: &State) -> impl Iterator<Item = Geometry> + '_ {
    state
        .town
        .towns
        .iter()
        .flat_map(|t| t.holdings())
        .filter(|h| {
            h.slot
                .habitat
                .shares_surface(crate::town::templates::Habitat::Ground)
        })
        .flat_map(|h| h.buildings.iter().cloned())
}
/// Built walls reserve land. Only a recorded gate opens the wall to a new way.
fn fortifications(
    features: &dyn FeatureReader,
    area: Option<Id>,
    ground: &mut Ground,
    spatial: &dyn SpatialKernel,
    scale: TownScale,
) -> io::Result<()> {
    use super::{
        ground::WALL,
        settings::{GATE_WIDTH, WALL_THICKNESS},
    };
    for (kind, width) in [("wall", WALL_THICKNESS), ("gate", GATE_WIDTH)] {
        let width = scale.length(width, Measure::Width);
        for item in features.values(FeatureSelection {
            area_id: area,
            layer_id: Some("structures"),
            kind: Some(kind),
        })? {
            let feature = item?;
            let outline = match feature.footprint {
                Some(shape) => shape,
                None => match feature.geometry {
                    shape @ (Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }) => shape,
                    shape => match spatial
                        .buffer(&shape, width / 2.)
                        .map_err(io::Error::other)?
                    {
                        Some(shape) => shape,
                        None => continue,
                    },
                },
            };
            if kind == "wall" {
                ground.mark_shapes(&[outline], WALL, spatial)?;
            } else {
                ground.release_shape(&outline, WALL, spatial)?;
            }
        }
    }
    Ok(())
}
/// The ground the map's drawn water covers: each channel at its full width at every vertex
/// (written by `real-scale.channels`), and lakes and pools by their outlines.
fn drawn_water(
    features: &dyn FeatureReader,
    area: Option<Id>,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Geometry>> {
    let mut found = Vec::new();
    for layer in ["rivers", "lakes"] {
        for feature in features.values(FeatureSelection {
            area_id: area,
            layer_id: Some(layer),
            kind: None,
        })? {
            found.push(feature?);
        }
    }
    water_shapes(&found, spatial)
}
/// The outline of each water feature: a channel widened to its width at every vertex, a lake
/// or pool as drawn. A channel with no widths stated covers only the triangles it runs on.
pub fn water_shapes(
    features: &[Feature],
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Geometry>> {
    let mut shapes = Vec::new();
    for feature in features {
        match &feature.geometry {
            Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => {
                shapes.push(feature.geometry.clone())
            }
            line => shapes.extend(
                atlas_map::hexes::widened_footprint(
                    line,
                    feature.attributes.get("widths"),
                    spatial,
                )
                .map_err(io::Error::other)?,
            ),
        }
    }
    Ok(shapes)
}
/// Every line in the roads layer except sea lanes, with its widest stated width; a way with
/// none stated takes the unstated width at `scale`.
fn ways(
    features: &dyn FeatureReader,
    area: Option<Id>,
    scale: TownScale,
) -> io::Result<Vec<(Vec<Point>, f64)>> {
    let unstated = scale.length(UNSTATED_WAY_WIDTH, Measure::Width);
    let mut result = Vec::new();
    for feature in features.values(FeatureSelection {
        area_id: area,
        layer_id: Some("roads"),
        kind: None,
    })? {
        let feature = feature?;
        if feature.attributes.get("wayKind").and_then(Value::as_str) == Some("sea") {
            continue;
        }
        let width = feature
            .attributes
            .get("widths")
            .and_then(Value::as_array)
            .and_then(|w| w.iter().filter_map(Value::as_f64).reduce(f64::max))
            .unwrap_or(unstated);
        result.extend(lines(&feature.geometry).into_iter().map(|l| (l, width)));
    }
    Ok(result)
}
/// Standing water and steep ground per triangle. Channels reserve their drawn footprint in
/// `read`, so a narrow river does not withhold the entire triangle that carries it.
fn marks(field: &Field) -> io::Result<Vec<u32>> {
    let slope = field.shared().scalar(Scalar::Slope);
    let kind = field.water().column.kind;
    (0..field.mesh().len())
        .map(|cell| {
            Ok(if kind.get(cell)? != 0 {
                WATER
            } else if slope.get(cell)? > STEEP_SLOPE {
                STEEP
            } else {
                0
            })
        })
        .collect()
}
fn ground(field: &Field, bounds: [f64; 4], scale: TownScale) -> io::Result<Ground> {
    let side = (bounds[2] - bounds[0]).max(bounds[3] - bounds[1]);
    let finest = scale.length(FINEST_CELL, Measure::Ground);
    let mut ground = Ground::new(bounds, (side / MOST_CELLS_ACROSS).max(finest));
    let marks = marks(field)?;
    let mesh = field.mesh();
    let origin = mesh.origin();
    let elevation = field.ground().view(GroundField::Elevation);
    let gradients = marks
        .iter()
        .enumerate()
        .map(|(cell, mark)| {
            if *mark == STEEP {
                mesh.gradient(cell, &|i| elevation.get(i))
            } else {
                Ok([0.; 2])
            }
        })
        .collect::<io::Result<Vec<_>>>()?;
    for index in 0..ground.count() {
        let p = ground.centre(index);
        if p[0] > bounds[2] || p[1] > bounds[3] {
            ground.withhold(index, OUTSIDE);
        } else if let Some(cell) = cell_at(mesh, p) {
            ground.withhold(index, marks[cell]);
            if marks[cell] == STEEP {
                ground.set_hillside(index, gradients[cell]);
            }
        }
    }
    for (cell, &mark) in marks.iter().enumerate() {
        let [x, y] = mesh.position(cell);
        if mark != 0 {
            if let Some(index) = ground.index([x + origin[0], y + origin[1]]) {
                ground.withhold(index, mark);
                if mark == STEEP {
                    ground.set_hillside(index, gradients[cell]);
                }
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
fn roads(features: &dyn FeatureReader, area: Option<Id>) -> io::Result<Vec<Road>> {
    let mut result = Vec::new();
    for kind in ["road", "trail"] {
        for feature in features.values(FeatureSelection {
            area_id: area,
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
/// Keep a habitable captured origin; if it is submerged or inaccessible, use its nearest dry candidate.
pub fn town_centre(
    centre: Point,
    candidates: &[Point],
    ground: &Ground,
    spatial: &dyn SpatialKernel,
) -> io::Result<Point> {
    let fits = |point| ground.owner(point) == FREE;
    if fits(centre) {
        return Ok(centre);
    }
    let sites: Vec<_> = candidates
        .iter()
        .copied()
        .filter(|&point| fits(point))
        .map(|point| Geometry::Point {
            coordinates: Position::xy(point[0], point[1]),
        })
        .collect();
    if sites.is_empty() {
        return Ok(centre);
    }
    let index = spatial.index(&sites).map_err(io::Error::other)?;
    let nearest = index
        .nearest(Position::xy(centre[0], centre[1]))
        .map_err(io::Error::other)?;
    Ok(match nearest.map(|i| &sites[i]) {
        Some(Geometry::Point { coordinates }) => {
            let [x, y, _] = coordinates.coordinates();
            [x, y]
        }
        _ => centre,
    })
}
fn seats(
    state: &State,
    features: &dyn FeatureReader,
    area: Option<Id>,
    bounds: [f64; 4],
    roads: &[Road],
    ground: &Ground,
) -> io::Result<Vec<Seat>> {
    let mut seats = Vec::new();
    let mesh = state.field().mesh();
    let origin = mesh.origin();
    let candidates: Vec<_> = (0..mesh.len())
        .map(|cell| {
            let p = mesh.position(cell);
            [p[0] + origin[0], p[1] + origin[1]]
        })
        .collect();
    // A district map grows from its district: the city map's district polygon covering the
    // frame's centre is its one seat, with the district's people and built ground.
    let middle = Position::xy((bounds[0] + bounds[2]) / 2., (bounds[1] + bounds[3]) / 2.);
    for feature in features.values(FeatureSelection {
        area_id: area,
        layer_id: Some("settlements"),
        kind: Some("district"),
    })? {
        let feature = feature?;
        let covers = state
            .spatial
            .covers_points(&feature.geometry, &[middle])
            .map_err(io::Error::other)?;
        if covers.first() == Some(&true) {
            let [x, y, _] = state
                .spatial
                .interior_position(&feature.geometry)
                .map_err(io::Error::other)?
                .coordinates();
            let centre = town_centre([x, y], &candidates, ground, state.spatial.as_ref())?;
            return Ok(vec![seat(state, &feature, centre, roads, bounds)?]);
        }
    }
    for feature in features.values(FeatureSelection {
        area_id: area,
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
        let centre = town_centre([x, y], &candidates, ground, state.spatial.as_ref())?;
        seats.push(seat(state, &feature, centre, roads, bounds)?);
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
    bounds: [f64; 4],
) -> io::Result<Seat> {
    let scale = state.town.scale();
    let meeting = Meeting {
        centre,
        reach: scale
            .length(MEETING_REACH, Measure::Layout)
            .max(0.25 * (bounds[2] - bounds[0]).max(bounds[3] - bounds[1])),
        name: &feature.name,
        scale,
    };
    let (arms, strategic) = ways_in(state.spatial.as_ref(), roads, &meeting)?;
    let guarded =
        strategic || feature.attributes.get("fortress").and_then(Value::as_bool) == Some(true);
    let story = story(feature, arms.len(), guarded);
    Ok(Seat {
        key: feature.id,
        name: feature.name.clone(),
        centre,
        story,
        arms,
        culture: text(feature, "namingCulture").map(str::to_owned),
    })
}
/// The arms the ways give a seat, and whether a strategic way is among them.
fn ways_in(
    spatial: &dyn SpatialKernel,
    roads: &[Road],
    meeting: &Meeting<'_>,
) -> io::Result<(Vec<Arm>, bool)> {
    let mut arms = Vec::new();
    let mut strategic = false;
    for road in roads {
        let before = arms.len();
        for line in &road.lines {
            arms_of(spatial, line, &road.ends, meeting, &mut arms)?;
        }
        strategic |= road.strategic && arms.len() > before;
    }
    Ok((arms, strategic))
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
        built_area: number(attributes, "builtKm2").unwrap_or_default() * 1_000_000.,
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
/// way in, its name, which a way's label names at one end, and the scale its arms are laid at.
struct Meeting<'a> {
    centre: Point,
    reach: f64,
    name: &'a str,
    scale: TownScale,
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
    let (centre, reach, name, scale) = (meeting.centre, meeting.reach, meeting.name, meeting.scale);
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
    let probe = scale.length(HEADING_PROBE, Measure::Layout);
    for (part, end) in [(back, 0), (rest(line, along), 1)] {
        if line_length(&part) < 2.0 * vertex_step(scale) {
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
            probe,
        );
    }
    Ok(())
}
/// An arm's heading, read `probe` metres along it.
fn heading_of(arm: &Arm, probe: f64) -> f64 {
    let probe =
        at(&arm.points, probe.min(line_length(&arm.points))).map_or(arm.points[0], |(p, _)| p);
    angle(sub(probe, arm.points[0]))
}
/// Adds an arm unless one already leaves the centre the same way, its heading read `probe`
/// metres along it.
fn add_arm(arms: &mut Vec<Arm>, arm: Arm, probe: f64) {
    let heading = heading_of(&arm, probe);
    let same = arms.iter_mut().find(|other| {
        let gap = (heading_of(other, probe) - heading).rem_euclid(std::f64::consts::TAU);
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
/// The farmland and pasture shares of the triangle under a point.
pub fn shares(field: &Field, p: Point) -> io::Result<(f64, f64)> {
    let Some(cell) = cell_at(field.mesh(), p) else {
        return Ok((0.0, 0.0));
    };
    worked_shares(field, cell)
}
pub(super) fn worked_shares(field: &Field, cell: usize) -> io::Result<(f64, f64)> {
    let people = field.people();
    let slope = field.shared().scalar(Scalar::Slope).get(cell)?;
    let ice = field.shared().scalar(Scalar::IceThickness).get(cell)?;
    let soil = field.ground().view(GroundField::SoilDepth).get(cell)?;
    let workable = soil / (soil + 0.08) / (1. + ice) / (1. + slope / STEEP_SLOPE);
    Ok((
        people
            .view(HumanField::Layer(LayerId::Farmland))
            .get(cell)?
            * workable,
        people.view(HumanField::Layer(LayerId::Pasture)).get(cell)? / (1. + ice),
    ))
}
/// Square metres the map's people farm and graze, by their shares on its triangles.
pub fn farmed(field: &Field) -> io::Result<f64> {
    (0..field.mesh().len()).try_fold(0.0, |sum, cell| {
        let (farmland, pasture) = worked_shares(field, cell)?;
        Ok(sum + (farmland + pasture) * field.mesh().area(cell))
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
        add_arm(&mut arms, arm([500.0, 0.0], None), HEADING_PROBE);
        add_arm(
            &mut arms,
            arm([500.0, 20.0], Some("Elder Ford")),
            HEADING_PROBE,
        );
        add_arm(&mut arms, arm([-500.0, 0.0], Some("Kell")), HEADING_PROBE);
        assert_eq!(arms.len(), 2);
        assert_eq!(arms[0].destination.as_deref(), Some("Elder Ford"));
        assert_eq!(arms[1].destination.as_deref(), Some("Kell"));
    }
}
