use crate::{
    features::{Feature, State},
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Position};
// hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
use std::collections::{BTreeMap, BTreeSet};

type Key = String;
struct Node {
    point: Position,
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    adjacent: BTreeSet<Key>,
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    owners: BTreeSet<usize>,
}
fn key(point: Position) -> Key {
    let [x, y, _] = point.coordinates();
    format!("{x:.6},{y:.6}")
}
fn lines(shape: &Geometry) -> Vec<Vec<Position>> {
    match shape {
        Geometry::LineString { coordinates } => vec![coordinates.clone()],
        Geometry::Polygon { coordinates } | Geometry::MultiLineString { coordinates } => {
            coordinates.clone()
        }
        Geometry::MultiPolygon { coordinates } => coordinates.iter().flatten().cloned().collect(),
        Geometry::GeometryCollection { geometries } => geometries.iter().flat_map(lines).collect(),
        _ => Vec::new(),
    }
}
// hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
fn node(nodes: &mut BTreeMap<Key, Node>, point: Position) -> &mut Node {
    nodes.entry(key(point)).or_insert_with(|| Node {
        point,
        // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
        adjacent: BTreeSet::new(),
        // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
        owners: BTreeSet::new(),
    })
}
pub fn soften(
    features: &[&Feature],
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    shapes: &mut BTreeMap<String, Option<Geometry>>,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<()> {
    if features.len() < 2 {
        return Ok(());
    }
    let boundaries = Geometry::MultiLineString {
        coordinates: features.iter().flat_map(|f| lines(&f.geometry)).collect(),
    };
    let noded = spatial.node_lines(&boundaries)?;
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    let mut nodes = BTreeMap::new();
    for line in noded.as_ref().map(lines).unwrap_or_default() {
        for pair in line.windows(2) {
            node(&mut nodes, pair[0]).adjacent.insert(key(pair[1]));
            node(&mut nodes, pair[1]).adjacent.insert(key(pair[0]));
        }
    }
    for (index, feature) in features.iter().enumerate() {
        for point in lines(&feature.geometry).into_iter().flatten() {
            node(&mut nodes, point).owners.insert(index);
        }
    }
    relax(&mut nodes, features, spatial)?;
    for feature in features {
        shapes.insert(feature.id.clone(), Some(replace(&feature.geometry, &nodes)));
    }
    Ok(())
}
fn relax(
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    nodes: &mut BTreeMap<Key, Node>,
    features: &[&Feature],
    spatial: &dyn SpatialKernel,
) -> SpatialResult<()> {
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    let mut fixed = BTreeSet::new();
    for _ in 0..3 {
        // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
        let mut next = BTreeMap::new();
        for (id, n) in nodes.iter() {
            if fixed.contains(id) || n.adjacent.len() != 2 || n.owners.len() < 2 {
                continue;
            }
            if n.owners
                .iter()
                .any(|&i| features[i].state != State::Generated || features[i].protected)
            {
                continue;
            }
            let mut neighbors = n.adjacent.iter().map(|id| nodes[id].point);
            next.insert(
                id.clone(),
                relaxed(
                    n.point,
                    neighbors.next().unwrap(),
                    neighbors.next().unwrap(),
                ),
            );
        }
        let previous = next
            .keys()
            .map(|id| (id.clone(), nodes[id].point))
            // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
            .collect::<BTreeMap<_, _>>();
        for (id, point) in &next {
            nodes.get_mut(id).unwrap().point = *point;
        }
        retain_valid(nodes, features, spatial, &mut next, &previous, &mut fixed)?;
    }
    Ok(())
}
fn retain_valid(
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    nodes: &mut BTreeMap<Key, Node>,
    features: &[&Feature],
    spatial: &dyn SpatialKernel,
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    next: &mut BTreeMap<Key, Position>,
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    previous: &BTreeMap<Key, Position>,
    // hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
    fixed: &mut BTreeSet<Key>,
) -> SpatialResult<()> {
    while !next.is_empty() {
        let invalid = features
            .iter()
            .filter(|f| spatial.canonical(&replace(&f.geometry, nodes)).is_err())
            .collect::<Vec<_>>();
        if invalid.is_empty() {
            break;
        }
        let mut restored = false;
        for feature in invalid {
            for point in lines(&feature.geometry).into_iter().flatten() {
                let id = key(point);
                if next.remove(&id).is_none() {
                    continue;
                }
                nodes.get_mut(&id).unwrap().point = previous[&id];
                fixed.insert(id);
                restored = true;
            }
        }
        if !restored {
            return Err("Illustration input contains an invalid polygon ring".into());
        }
    }
    Ok(())
}
fn relaxed(point: Position, a: Position, b: Position) -> Position {
    let [x, y, _] = point.coordinates();
    let [ax, ay, _] = a.coordinates();
    let [bx, by, _] = b.coordinates();
    let dx = (ax - 2.0 * x + bx) / 4.0;
    let dy = (ay - 2.0 * y + by) / 4.0;
    let shortest = (ax - x).hypot(ay - y).min((bx - x).hypot(by - y));
    let fraction = (shortest / 2.0 / dx.hypot(dy).max(1e-9)).min(1.0);
    Position::xy(x + dx * fraction, y + dy * fraction)
}
// hpc-exempt: noded feature-boundary vertices and sparse feature ownership, not generation cells.
fn replace(shape: &Geometry, nodes: &BTreeMap<Key, Node>) -> Geometry {
    let polygon = |rings: &[Vec<Position>]| {
        rings
            .iter()
            .map(|ring| ring.iter().map(|p| nodes[&key(*p)].point).collect())
            .collect()
    };
    match shape {
        Geometry::Polygon { coordinates } => Geometry::Polygon {
            coordinates: polygon(coordinates),
        },
        Geometry::MultiPolygon { coordinates } => Geometry::MultiPolygon {
            coordinates: coordinates.iter().map(|p| polygon(p)).collect(),
        },
        _ => shape.clone(),
    }
}
