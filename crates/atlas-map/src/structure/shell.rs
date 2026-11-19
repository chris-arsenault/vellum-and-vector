//! The generated part of a structure map: the building's shell on each of its levels. The
//! footprint becomes outer walls on every level, the wall facing the street is the front,
//! and the ground floor's front wall holds the door. Nothing else is generated inside;
//! rooms, stairs, furniture and decor are drawn by the creator.
use super::{level_hexes, level_layout, set_marks, StructureSite};
use crate::{
    authoring::footprint,
    hexes::{mark_shape, marks, MarkSource},
    spatial::SpatialKernel,
    Bounds, CreatorLayer, Geometry, LayerSource, MapDescriptor, MapFeature, MapFeatureCatalog,
    MapRef, MapRelation, Position, PublicationState, RealScale, RealScaleKind, RegionGeometry,
    VectorSource,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// The shell's settings, declared once in `structure.json`.
fn settings() -> &'static super::vocabulary::ShellSettings {
    &super::vocabulary().shell
}

/// The hex size a structure map is opened at, from the shared ladder.
#[derive(Clone, Debug, PartialEq)]
pub struct HexChoice {
    pub label: String,
    pub across_flats: f64,
    pub feet: f64,
}
pub struct ShellRequest<'a> {
    pub parent: &'a MapDescriptor,
    pub building: &'a MapFeature,
    /// The way the building fronts (its `fronts` relation), when the parent has it.
    pub street: Option<&'a MapFeature>,
    pub reference: MapRef,
    pub hex: HexChoice,
    /// The one published asset every layer of the new map names.
    pub asset_id: String,
}
pub struct Shell {
    pub map: MapDescriptor,
    pub features: Vec<MapFeature>,
}

type Point = [f64; 2];

/// The building's outline as a counter-clockwise ring without its closing point.
fn outline(building: &MapFeature) -> Result<Vec<Point>, String> {
    let ring = match &building.geometry {
        Geometry::Polygon { coordinates } => coordinates.first(),
        Geometry::MultiPolygon { coordinates } => coordinates.first().and_then(|p| p.first()),
        _ => None,
    }
    .ok_or("A building needs an outline to open its floors")?;
    let mut points: Vec<Point> = ring
        .iter()
        .map(|p| {
            let [x, y, _] = p.coordinates();
            [x, y]
        })
        .collect();
    if points.len() > 1 && points.first() == points.last() {
        points.pop();
    }
    if points.len() < 3 {
        return Err("A building outline needs three or more corners".into());
    }
    let twice_area: f64 = (0..points.len())
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % points.len()]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum();
    if twice_area < 0.0 {
        points.reverse();
    }
    Ok(points)
}
fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length = dx * dx + dy * dy;
    let t = if length == 0.0 {
        0.0
    } else {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length).clamp(0.0, 1.0)
    };
    (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
}
fn line_points(geometry: &Geometry) -> Vec<Point> {
    let lines: Vec<&Vec<Position>> = match geometry {
        Geometry::LineString { coordinates } => vec![coordinates],
        Geometry::MultiLineString { coordinates } | Geometry::Polygon { coordinates } => {
            coordinates.iter().collect()
        }
        _ => Vec::new(),
    };
    lines
        .into_iter()
        .flatten()
        .map(|p| {
            let [x, y, _] = p.coordinates();
            [x, y]
        })
        .collect()
}
/// The edge whose middle lies nearest the street; without a street, the longest edge.
pub fn frontage(ring: &[Point], street: Option<&Geometry>) -> usize {
    let edges = (0..ring.len()).map(|i| (ring[i], ring[(i + 1) % ring.len()]));
    let street = street.map(line_points).filter(|points| points.len() >= 2);
    let score = |(a, b): (Point, Point)| match &street {
        Some(points) => {
            let middle = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
            points
                .windows(2)
                .map(|pair| segment_distance(middle, pair[0], pair[1]))
                .fold(f64::INFINITY, f64::min)
        }
        None => -(b[0] - a[0]).hypot(b[1] - a[1]),
    };
    edges
        .map(score)
        .enumerate()
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map_or(0, |(index, _)| index)
}
/// The compass side an edge of a counter-clockwise ring faces.
fn side((a, b): (Point, Point)) -> &'static str {
    let (nx, ny) = (b[1] - a[1], a[0] - b[0]);
    if nx.abs() >= ny.abs() {
        if nx > 0.0 {
            "East"
        } else {
            "West"
        }
    } else if ny > 0.0 {
        "North"
    } else {
        "South"
    }
}
/// The levels a building's floors open with: a cellar, the ground floor and its upper storeys.
pub fn shell_levels(building: &MapFeature) -> Vec<i32> {
    let storeys = building
        .attributes
        .get("storeys")
        .and_then(Value::as_i64)
        .unwrap_or(1)
        .clamp(1, 12) as i32;
    (-1..storeys).collect()
}
fn frame(ring: &[Point], across_flats: f64) -> Bounds {
    let margin = settings().frame_margin_hexes * across_flats;
    let (mut w, mut s, mut e, mut n) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for [x, y] in ring {
        (w, s, e, n) = (w.min(*x), s.min(*y), e.max(*x), n.max(*y));
    }
    Bounds(w - margin, s - margin, e + margin, n + margin)
}
fn rectangle(Bounds(w, s, e, n): Bounds) -> RegionGeometry {
    RegionGeometry::Polygon(vec![[[w, s], [e, s], [e, n], [w, n], [w, s]]
        .into_iter()
        .map(|[x, y]| Position::xy(x, y))
        .collect()])
}

/// The new structure map and its shell: outer walls on every level, the street door on the
/// ground floor's front wall, and each level's hexes marked by them.
pub fn shell(request: &ShellRequest<'_>, spatial: &dyn SpatialKernel) -> Result<Shell, String> {
    let ring = outline(request.building)?;
    let front = frontage(&ring, request.street.map(|street| &street.geometry));
    let mut map = descriptor(request, &ring)?;
    let mut features = Vec::new();
    for number in shell_levels(request.building) {
        let (space, layers) = level_layout(&map, &request.parent.layers, number)?;
        if number != 0 {
            map.spaces.push(space);
        }
        let layers: Vec<_> = layers
            .into_iter()
            .map(|layer| shared_asset(layer, request))
            .collect();
        let mut level = walls(&layers[0], &ring, front, number)?;
        if number == 0 {
            level.push(door(&layers[0], &level[front], request.street)?);
        }
        for feature in &mut level {
            feature.footprint = footprint(feature, spatial)?;
        }
        let mut hexes = level_hexes(&map, &layers[2])?;
        mark(&map, &mut hexes, &level, spatial)?;
        level.extend(hexes);
        count(&mut map, &layers, &level);
        features.extend(level);
    }
    Ok(Shell { map, features })
}
fn shared_asset(mut layer: crate::MapLayer, request: &ShellRequest<'_>) -> crate::MapLayer {
    layer.source = LayerSource::Vector(VectorSource {
        asset_id: request.asset_id.clone(),
        media_type: "application/geo+json".into(),
    });
    layer
}
fn count(map: &mut MapDescriptor, layers: &[crate::MapLayer], features: &[MapFeature]) {
    for mut layer in layers.iter().cloned() {
        for kind in &mut layer.catalog.feature_types {
            kind.count = features
                .iter()
                .filter(|f| f.layer_id == layer.id && f.type_id == kind.id)
                .count() as u32;
        }
        map.layers.push(layer);
    }
}
fn mark(
    map: &MapDescriptor,
    hexes: &mut [MapFeature],
    shapes: &[MapFeature],
    spatial: &dyn SpatialKernel,
) -> Result<(), String> {
    let grid = map.real_scale.as_ref().ok_or("No hex grid")?.grid()?;
    let addresses: Vec<_> = hexes
        .iter()
        .map(|hex| crate::hexes::Hex {
            q: hex.attributes["q"].as_i64().unwrap_or_default() as i32,
            r: hex.attributes["r"].as_i64().unwrap_or_default() as i32,
        })
        .collect();
    let shapes: Vec<_> = shapes.iter().filter_map(mark_shape).collect();
    let sources: Vec<_> = shapes
        .iter()
        .map(|(geometry, mark)| MarkSource { geometry, mark })
        .collect();
    for (hex, marks) in hexes
        .iter_mut()
        .zip(marks(&grid, &addresses, &sources, spatial)?)
    {
        set_marks(hex, &marks);
    }
    Ok(())
}
fn descriptor(request: &ShellRequest<'_>, ring: &[Point]) -> Result<MapDescriptor, String> {
    let parent = request.parent;
    let building = request.building;
    let bounds = frame(ring, request.hex.across_flats);
    // The ground floor stands in the parent's space; its ancestors come along so it resolves.
    let mut spaces = Vec::new();
    let mut next = Some(building.space_id.clone());
    while let Some(id) = next.take() {
        let space = parent
            .spaces
            .iter()
            .find(|space| space.id == id)
            .ok_or("The building's space is not on its map")?;
        next.clone_from(&space.parent_space_id);
        spaces.insert(0, space.clone());
    }
    let text = |key: &str| {
        building
            .attributes
            .get(key)
            .and_then(Value::as_str)
            .map(String::from)
    };
    let name = building
        .name
        .clone()
        .or_else(|| text("address"))
        .unwrap_or_else(|| "Building".into());
    let mut scale = parent.region_scale.clone();
    scale.enabled = false;
    Ok(MapDescriptor {
        reference: request.reference.clone(),
        world_id: parent.world_id.clone(),
        name,
        primary_space_id: building.space_id.clone(),
        profile: "interior".into(),
        region_scale: scale,
        footprint: rectangle(bounds),
        bounds,
        spaces,
        parent: Some(parent.reference.clone()),
        state: PublicationState::Incomplete,
        layers: Vec::new(),
        real_scale: Some(RealScale {
            kind: RealScaleKind::Structure,
            hex_size: request.hex.label.clone(),
            across_flats: request.hex.across_flats,
            feet: request.hex.feet,
            origin: [(bounds.0 + bounds.2) / 2.0, (bounds.1 + bounds.3) / 2.0],
            triangles_per_edge: parent
                .real_scale
                .as_ref()
                .map_or(1, |r| r.triangles_per_edge),
            creator_layers: vec![CreatorLayer::base()],
            edits: 0,
            site: Some(StructureSite {
                building_id: building.id,
                name: building.name.clone(),
                use_: text("use"),
                address: text("address"),
            }),
            authoring: Default::default(),
        }),
    })
}
fn shell_feature(
    layer: &crate::MapLayer,
    id: crate::Id,
    kind: &str,
    name: &str,
) -> Result<MapFeature, String> {
    let type_id = layer
        .catalog
        .feature_types
        .iter()
        .find(|entry| entry.kind == kind)
        .ok_or_else(|| format!("{kind} is not a kind of {}", layer.name))?
        .id
        .clone();
    Ok(MapFeature {
        id,
        space_id: layer.space_id.clone(),
        entity_id: None,
        layer_id: layer.id.clone(),
        name: Some(name.into()),
        kind: kind.into(),
        type_id,
        catalog: MapFeatureCatalog {
            values: BTreeMap::new(),
            columns: Vec::new(),
            origin: "Generated".into(),
            map_only: false,
        },
        geometry: Geometry::Point {
            coordinates: Position::xy(0.0, 0.0),
        },
        footprint: None,
        attributes: BTreeMap::new(),
        relations: Vec::new(),
        causes: Vec::new(),
    })
}
/// One outer wall per edge of the footprint, each a line with the wall's thickness.
fn walls(
    layer: &crate::MapLayer,
    ring: &[Point],
    front: usize,
    number: i32,
) -> Result<Vec<MapFeature>, String> {
    (0..ring.len())
        .map(|i| {
            let edge = (ring[i], ring[(i + 1) % ring.len()]);
            let name = if i == front {
                "Front wall".to_owned()
            } else {
                format!("{} wall", side(edge))
            };
            // One outer wall per edge of the ring on each level.
            let mut place = number.to_be_bytes().to_vec();
            place.extend_from_slice(&(i as u32).to_be_bytes());
            let id = crate::Id::v5(crate::Id::from_name(&layer.id), &place);
            let mut wall = shell_feature(layer, id, "wall", &name)?;
            wall.geometry = Geometry::LineString {
                coordinates: vec![
                    Position::xy(edge.0[0], edge.0[1]),
                    Position::xy(edge.1[0], edge.1[1]),
                ],
            };
            wall.attributes = BTreeMap::from([
                (
                    "widths".into(),
                    json!([settings().outer_wall, settings().outer_wall]),
                ),
                ("outer".into(), true.into()),
                ("frontage".into(), (i == front).into()),
            ]);
            Ok(wall)
        })
        .collect()
}
/// The street door: an outline across the middle of the front wall, turned with it.
fn door(
    layer: &crate::MapLayer,
    wall: &MapFeature,
    street: Option<&MapFeature>,
) -> Result<MapFeature, String> {
    let points = line_points(&wall.geometry);
    let (a, b) = (points[0], points[1]);
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length = dx.hypot(dy);
    let (ux, uy) = (dx / length, dy / length);
    let (width, thickness) = (settings().street_door, settings().outer_wall);
    // The door's outline spans the wall's thickness with a hand's breadth to spare.
    let (half_along, half_across) = (width.min(length * 0.5) / 2.0, (thickness + 0.1) / 2.0);
    let [cx, cy] = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    let corner = |s: f64, t: f64| Position::xy(cx + ux * s - uy * t, cy + uy * s + ux * t);
    let ring = vec![
        corner(-half_along, -half_across),
        corner(half_along, -half_across),
        corner(half_along, half_across),
        corner(-half_along, half_across),
        corner(-half_along, -half_across),
    ];
    let id = crate::Id::v5(crate::Id::from_name(&layer.id), b"front door");
    let mut door = shell_feature(layer, id, "door", "Front door")?;
    door.geometry = Geometry::Polygon {
        coordinates: vec![ring],
    };
    door.attributes = BTreeMap::from([
        (
            "rotation".into(),
            json!((uy.atan2(ux).to_degrees() * 100.0).round() / 100.0),
        ),
        ("outside".into(), true.into()),
    ]);
    if let Some(street) = street.and_then(|s| s.name.clone()) {
        door.attributes.insert("street".into(), street.into());
    }
    door.relations.push(MapRelation {
        target_id: wall.id,
        target_map_id: None,
        target_name: wall.name.clone().unwrap_or_default(),
        kind: "in".into(),
    });
    Ok(door)
}
