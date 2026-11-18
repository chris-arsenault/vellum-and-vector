//! Routes are rebuilt from noded streets and declared doors. Entrances split a stretch
//! for the current read while the measured street and its holding addresses retain their identity.
pub(super) mod walking;
use super::{
    catalogue::AccessUse,
    fabric::{Endpoint, Holding, Town},
    geometry::{at, distance, Point},
    network::Street,
};
use crate::{
    hpc::{Direction, KeyedHeap},
    spatial::SpatialKernel,
};
use atlas_map::{Geometry, Position};
use std::{collections::BTreeMap, io};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct JunctionId(pub i64, pub i64);
impl JunctionId {
    fn at([x, y]: Point) -> Self {
        Self((x * 1000.).round() as i64, (y * 1000.).round() as i64)
    }
    pub fn point(self) -> Point {
        [self.0 as f64 / 1000., self.1 as f64 / 1000.]
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Stretch {
    pub street: usize,
    pub from: JunctionId,
    pub to: JunctionId,
}
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub struct StreetLoad {
    pub street: usize,
    pub start: f64,
    pub end: f64,
    pub value: f64,
}
impl Stretch {
    fn between(street: usize, a: Point, b: Point) -> Self {
        let a = JunctionId::at(a);
        let b = JunctionId::at(b);
        Self {
            street,
            from: a.min(b),
            to: a.max(b),
        }
    }
    pub fn length(self) -> f64 {
        distance(self.from.point(), self.to.point())
    }
}
#[derive(Clone, Copy)]
pub struct Entrance {
    point: Point,
    street: Option<usize>,
    walk: f64,
    independent: bool,
}
impl Entrance {
    pub fn independent(point: Point) -> Self {
        Self {
            independent: true,
            ..Self::external(point)
        }
    }
    pub fn external(point: Point) -> Self {
        Self {
            point,
            street: None,
            walk: 0.,
            independent: false,
        }
    }
    pub fn holding(town: &Town, holding: &Holding) -> Self {
        let mut frontage = holding;
        let mut walk = 0.;
        while let Some(host) = frontage
            .access_via
            .filter(|id| *id < frontage.id)
            .and_then(|id| town.holdings().get(id.0 as usize))
        {
            walk += distance(frontage.slot.front, host.slot.front);
            frontage = host;
        }
        let mut entrance = Self::slot(town, &frontage.slot);
        entrance.walk += walk;
        entrance
    }
    pub fn slot(town: &Town, slot: &super::plots::Slot) -> Self {
        let street = slot.street;
        let point = street
            .and_then(|i| town.streets().get(i))
            .and_then(|s| at(&s.points, slot.along))
            .map_or(slot.front, |(p, _)| p);
        Self {
            point,
            street,
            walk: distance(slot.front, point),
            independent: street.is_none(),
        }
    }
    pub fn source(town: &Town, endpoint: &Endpoint, position: Point) -> Self {
        if let Endpoint::Premises { town: key, holding } = endpoint {
            if *key == town.seat.key {
                if let Some(h) = town.holdings().get(holding.0 as usize) {
                    return Self::holding(town, h);
                }
            }
        }
        Self::external(position)
    }
}
#[derive(Clone, Copy)]
struct Leg {
    street: usize,
    width: f64,
    ends: [Point; 2],
}
pub struct Access<'a> {
    legs: Vec<Leg>,
    geometries: Vec<Geometry>,
    links: Vec<(Point, Point, f64)>,
    ground: Option<&'a super::ground::Ground>,
}
fn lines(value: Geometry) -> Vec<Vec<Position>> {
    match value {
        Geometry::LineString { coordinates } => vec![coordinates],
        Geometry::MultiLineString { coordinates } => coordinates,
        Geometry::GeometryCollection { geometries } => {
            geometries.into_iter().flat_map(lines).collect()
        }
        _ => vec![],
    }
}
fn xy(position: Position) -> Point {
    let [x, y, _] = position.coordinates();
    [x, y]
}
fn pos(point: Point) -> Position {
    Position::xy(point[0], point[1])
}
impl<'a> Access<'a> {
    pub fn on_ground(mut self, ground: &'a super::ground::Ground) -> Self {
        self.ground = Some(ground);
        self
    }
    pub fn new(streets: &[Street], spatial: &dyn SpatialKernel) -> io::Result<Self> {
        let mut access = Self {
            legs: vec![],
            geometries: vec![],
            links: vec![],
            ground: None,
        };
        if streets.is_empty() {
            return Ok(access);
        }
        let parents: Vec<_> = streets
            .iter()
            .enumerate()
            .flat_map(|(street, s)| {
                s.points
                    .windows(2)
                    .zip(s.widths.windows(2))
                    .filter(|(p, _)| JunctionId::at(p[0]) != JunctionId::at(p[1]))
                    .map(move |(p, w)| {
                        (
                            Leg {
                                street,
                                width: w[0].min(w[1]),
                                ends: [p[0], p[1]],
                            },
                            super::edits::line(p),
                        )
                    })
            })
            .collect();
        if parents.is_empty() {
            return Ok(access);
        }
        let shapes: Vec<_> = parents.iter().map(|(_, g)| g.clone()).collect();
        let index = spatial.index(&shapes).map_err(io::Error::other)?;
        let geometry = Geometry::MultiLineString {
            coordinates: parents
                .iter()
                .map(|(leg, _)| leg.ends.iter().copied().map(pos).collect())
                .collect(),
        };
        let Some(noded) = spatial.node_lines(&geometry).map_err(io::Error::other)? else {
            return Ok(access);
        };
        let legs: Vec<_> = lines(noded)
            .into_iter()
            .flat_map(|line| {
                line.windows(2)
                    .map(|p| [xy(p[0]), xy(p[1])])
                    .filter(|p| JunctionId::at(p[0]) != JunctionId::at(p[1]))
                    .collect::<Vec<_>>()
            })
            .collect();
        let midpoints: Vec<_> = legs
            .iter()
            .map(|[a, b]| Position::xy((a[0] + b[0]) / 2., (a[1] + b[1]) / 2.))
            .collect();
        for (ends, parent) in legs
            .into_iter()
            .zip(index.nearest_many(&midpoints).map_err(io::Error::other)?)
        {
            let Some(i) = parent else { continue };
            access.legs.push(Leg {
                ends,
                ..parents[i].0
            });
            access.geometries.push(super::edits::line(&ends));
        }
        Ok(access)
    }
    pub fn add_link(
        &mut self,
        a: Point,
        b: Point,
        cost: f64,
        _: &dyn SpatialKernel,
    ) -> io::Result<()> {
        self.links.push((a, b, cost));
        Ok(())
    }
    pub fn costs(
        &self,
        source: Point,
        targets: &[Point],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Vec<f64>> {
        Ok(self
            .travel_costs(&[source], targets, spatial)?
            .pop()
            .unwrap_or_default())
    }
    pub fn travel_costs(
        &self,
        sources: &[Point],
        targets: &[Point],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Vec<Vec<f64>>> {
        let locations: Vec<_> = sources
            .iter()
            .chain(targets)
            .copied()
            .map(Entrance::external)
            .collect();
        let graph = self.bind(&locations, AccessUse::Foot, spatial)?;
        Ok((0..sources.len())
            .map(|s| {
                let tree = graph.routes(s);
                (sources.len()..locations.len())
                    .map(|t| tree.cost(t))
                    .collect()
            })
            .collect())
    }
    /// Attach all destinations in one pass. Adjacent named streets cannot steal a premises entrance.
    pub fn bind(
        &self,
        places: &[Entrance],
        mode: AccessUse,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<BoundNetwork> {
        let mut graph = BoundNetwork::default();
        let mut entries = places.to_vec();
        for (a, b, _) in &self.links {
            entries.extend([Entrance::external(*a), Entrance::external(*b)]);
        }
        self.attach(&entries, mode, spatial, &mut graph)?;
        if let Some(ground) = self
            .ground
            .filter(|_| mode == AccessUse::Foot && entries.iter().any(|e| e.street.is_none()))
        {
            walking::connect(ground, &entries, &mut graph, spatial)?;
        }
        for (i, (_, _, cost)) in self.links.iter().enumerate() {
            let end = places.len() + 2 * i;
            if let (Some((a, da)), Some((b, db))) = (graph.entrances[end], graph.entrances[end + 1])
            {
                graph.connect(a, b, cost + da + db, None);
            }
        }
        Ok(graph)
    }
    fn attach(
        &self,
        entries: &[Entrance],
        mode: AccessUse,
        spatial: &dyn SpatialKernel,
        graph: &mut BoundNetwork,
    ) -> io::Result<()> {
        graph.entrances.resize(entries.len(), None);
        let mut cuts: Vec<Vec<(f64, Point)>> = self
            .legs
            .iter()
            .map(|l| vec![(0., l.ends[0]), (distance(l.ends[0], l.ends[1]), l.ends[1])])
            .collect();
        // hpc-exempt: stable named-street identities scope spatial projections for bound entrances.
        let mut groups = BTreeMap::<Option<usize>, Vec<usize>>::new();
        let off_street_walking = mode == AccessUse::Foot && self.ground.is_some();
        for (i, e) in entries
            .iter()
            .enumerate()
            .filter(|(_, e)| !e.independent || off_street_walking)
        {
            groups.entry(e.street).or_default().push(i);
        }
        for (street, places) in groups {
            let indices: Vec<_> = self
                .legs
                .iter()
                .enumerate()
                .filter(|(_, l)| street.is_none_or(|s| s == l.street))
                .map(|(i, _)| i)
                .collect();
            if indices.is_empty() {
                continue;
            }
            let shapes: Vec<_> = indices
                .iter()
                .map(|&i| self.geometries[i].clone())
                .collect();
            let points: Vec<_> = places.iter().map(|&i| pos(entries[i].point)).collect();
            let nearest = spatial
                .index(&shapes)
                .map_err(io::Error::other)?
                .nearest_many(&points)
                .map_err(io::Error::other)?;
            for (i, nearest) in places.into_iter().zip(nearest) {
                let Some(segment) = nearest.map(|i| indices[i]) else {
                    continue;
                };
                if !mode.permits_width(self.legs[segment].width) {
                    continue;
                }
                let entrance = entries[i];
                let projected = xy(spatial
                    .nearest_points(
                        &Geometry::Point {
                            coordinates: pos(entrance.point),
                        },
                        &self.geometries[segment],
                    )
                    .map_err(io::Error::other)?[1]);
                let Some((vertex, offset)) = self.door_connection(entrance, projected, mode, graph)
                else {
                    continue;
                };
                cuts[segment].push((distance(self.legs[segment].ends[0], projected), projected));
                graph.entrances[i] = Some((vertex, offset));
            }
        }
        for (leg, mut cuts) in self.legs.iter().zip(cuts) {
            if !mode.permits_width(leg.width) {
                continue;
            }
            cuts.sort_by(|a, b| a.0.total_cmp(&b.0));
            for pair in cuts.windows(2) {
                let stretch = Stretch::between(leg.street, pair[0].1, pair[1].1);
                if stretch.from == stretch.to {
                    continue;
                }
                let a = graph.vertex(pair[0].1);
                let b = graph.vertex(pair[1].1);
                graph.connect(a, b, stretch.length(), Some(stretch));
            }
        }
        Ok(())
    }
    fn door_connection(
        &self,
        entrance: Entrance,
        projected: Point,
        mode: AccessUse,
        graph: &mut BoundNetwork,
    ) -> Option<(usize, f64)> {
        let gap = distance(entrance.point, projected);
        if let Some(ground) = self.ground.filter(|_| entrance.street.is_none()) {
            if !walking::clear(ground, entrance.point, projected) {
                return None;
            }
            if mode == AccessUse::Foot {
                let door = graph.vertex(entrance.point);
                let road = graph.vertex(projected);
                graph.connect(door, road, gap * walking::EFFORT, None);
                return Some((door, entrance.walk));
            }
        }
        Some((graph.vertex(projected), entrance.walk + gap))
    }
}
#[derive(Clone, Copy)]
struct Edge {
    to: usize,
    cost: f64,
    stretch: Option<Stretch>,
}
#[derive(Default)]
pub struct BoundNetwork {
    // hpc-exempt: keyed exact geometry junction identities constitute graph topology.
    vertices: BTreeMap<JunctionId, usize>,
    edges: Vec<Vec<Edge>>,
    entrances: Vec<Option<(usize, f64)>>,
}
impl BoundNetwork {
    fn vertex(&mut self, p: Point) -> usize {
        *self.vertices.entry(JunctionId::at(p)).or_insert_with(|| {
            self.edges.push(vec![]);
            self.edges.len() - 1
        })
    }
    fn connect(&mut self, a: usize, b: usize, cost: f64, stretch: Option<Stretch>) {
        self.edges[a].push(Edge {
            to: b,
            cost,
            stretch,
        });
        self.edges[b].push(Edge {
            to: a,
            cost,
            stretch,
        });
    }
    pub fn routes(&self, origin: usize) -> Routes<'_> {
        let mut routes = Routes {
            graph: self,
            costs: vec![f64::INFINITY; self.edges.len()],
            via: vec![None; self.edges.len()],
        };
        let Some((start, offset)) = self.entrances[origin] else {
            return routes;
        };
        let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
        routes.costs[start] = offset;
        heap.push(start as u32, [offset]);
        while let Some((id, [cost])) = heap.pop() {
            let id = id as usize;
            if cost > routes.costs[id] {
                continue;
            }
            for edge in &self.edges[id] {
                let next = cost + edge.cost;
                if next < routes.costs[edge.to] {
                    routes.costs[edge.to] = next;
                    routes.via[edge.to] = Some((id, edge.stretch));
                    heap.push(edge.to as u32, [next]);
                }
            }
        }
        routes
    }
}
pub struct Routes<'a> {
    graph: &'a BoundNetwork,
    costs: Vec<f64>,
    via: Vec<Option<(usize, Option<Stretch>)>>,
}
impl Routes<'_> {
    pub fn cost(&self, target: usize) -> f64 {
        self.graph.entrances[target].map_or(f64::INFINITY, |(v, offset)| self.costs[v] + offset)
    }
    pub fn visit(&self, target: usize, mut traversed: impl FnMut(Stretch)) {
        let Some((mut node, _)) = self.graph.entrances[target] else {
            return;
        };
        while let Some((previous, stretch)) = self.via[node] {
            if let Some(s) = stretch {
                traversed(s);
            }
            node = previous;
        }
    }
}
