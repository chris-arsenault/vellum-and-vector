//! Routes are rebuilt from noded streets and declared doors. Entrances split a stretch
//! for the current read while the measured street and its holding addresses retain their identity.
pub(crate) mod walking;
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
    pub(crate) fn at([x, y]: Point) -> Self {
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
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub struct Footpath {
    pub points: [Point; 2],
    pub wear: f64,
}
impl Footpath {
    /// A beaten walking track remains narrow until investment builds a street.
    pub fn width(&self) -> f64 {
        0.7
    }
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Approach {
    pub points: Vec<Point>,
    pub street: usize,
}
#[derive(Clone, Copy)]
pub enum Course {
    Street(Stretch),
    Walk,
    Link,
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
    paths: &'a [Footpath],
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
    pub fn for_town(town: &'a Town, spatial: &dyn SpatialKernel) -> io::Result<Self> {
        let mut network = Self::new(town.streets(), spatial)?;
        network.paths = town.footpaths();
        Ok(network)
    }
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
            paths: &[],
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
        let mut queries = graph.distance_queries();
        Ok((0..sources.len())
            .map(|s| {
                queries.from(s);
                (sources.len()..locations.len())
                    .map(|t| queries.cost(t))
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
        let retained = self
            .ground
            .filter(|_| mode == AccessUse::Foot)
            .map(|g| {
                self.paths
                    .iter()
                    .filter(|p| walking::clear(g, p.points[0], p.points[1]))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        // hpc-exempt: distinct junctions of retained informal paths join the walking graph.
        let mut path_ends = BTreeMap::new();
        for path in &retained {
            for p in path.points {
                path_ends.entry(JunctionId::at(p)).or_insert(p);
            }
        }
        entries.extend(path_ends.into_values().map(Entrance::independent));
        let junctions = self.attach(&entries, mode, spatial, &mut graph)?;
        for junction in junctions {
            let node = graph.vertex(junction);
            graph.entrances.push(Some((node, 0.)));
            entries.push(Entrance::external(junction));
        }
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
                graph.connect(a, b, cost + da + db, Course::Link);
            }
        }
        for path in retained {
            let [a, b] = path.points;
            let start = graph.vertex(a);
            let end = graph.vertex(b);
            let effort = 1. + (walking::EFFORT - 1.) / (1. + path.wear);
            graph.connect(start, end, distance(a, b) * effort, Course::Walk);
        }
        Ok(graph)
    }
    fn attach(
        &self,
        entries: &[Entrance],
        mode: AccessUse,
        spatial: &dyn SpatialKernel,
        graph: &mut BoundNetwork,
    ) -> io::Result<Vec<Point>> {
        let mut junctions = Vec::new();
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
                cuts[segment].push((distance(self.legs[segment].ends[0], projected), projected));
                graph.entrances[i] = self.door_connection(entrance, projected, mode, graph);
                if off_street_walking && graph.entrances[i].is_none() {
                    junctions.push(projected);
                }
            }
        }
        self.connect_stretches(cuts, mode, graph);
        Ok(junctions)
    }
    fn connect_stretches(
        &self,
        cuts: Vec<Vec<(f64, Point)>>,
        mode: AccessUse,
        graph: &mut BoundNetwork,
    ) {
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
                graph.connect(a, b, stretch.length(), Course::Street(stretch));
            }
        }
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
                graph.connect(door, road, gap * walking::EFFORT, Course::Walk);
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
    course: Course,
}
#[derive(Default)]
pub struct BoundNetwork {
    // hpc-exempt: keyed exact geometry junction identities constitute graph topology.
    vertices: BTreeMap<JunctionId, usize>,
    edges: Vec<Vec<Edge>>,
    points: Vec<Point>,
    entrances: Vec<Option<(usize, f64)>>,
}
impl BoundNetwork {
    pub(crate) fn connect_door(&mut self, index: usize, point: Point, porch: usize, cost: f64) {
        if let Some((outside, _)) = self.entrances[porch] {
            let door = self.vertex(point);
            self.connect(door, outside, cost, Course::Walk);
            self.entrances[index] = Some((door, 0.));
        }
    }
    pub(crate) fn exclude_walks(&mut self, blocked: &std::collections::BTreeSet<[JunctionId; 2]>) {
        for (i, edges) in self.edges.iter_mut().enumerate() {
            edges.retain(|edge| {
                !matches!(edge.course, Course::Walk)
                    || !blocked.contains(&super::fabric::walks::path_key(
                        self.points[i],
                        self.points[edge.to],
                    ))
            });
        }
    }
    fn vertex(&mut self, p: Point) -> usize {
        *self.vertices.entry(JunctionId::at(p)).or_insert_with(|| {
            self.edges.push(vec![]);
            self.points.push(p);
            self.edges.len() - 1
        })
    }
    fn connect(&mut self, a: usize, b: usize, cost: f64, course: Course) {
        self.edges[a].push(Edge {
            to: b,
            cost,
            course,
        });
        self.edges[b].push(Edge {
            to: a,
            cost,
            course,
        });
    }
    pub fn routes(&self, origin: usize) -> Routes<'_> {
        self.search(
            self.entrances[origin]
                .into_iter()
                .map(|(node, cost)| (node, cost, None)),
            false,
            |_| false,
        )
    }
    /// Only the requested journeys are observable. Stop after settling their destinations.
    pub(crate) fn routes_to(
        &self,
        origin: usize,
        destinations: impl Iterator<Item = usize>,
    ) -> Routes<'_> {
        let mut needed = vec![false; self.edges.len()];
        let mut remaining = 0;
        for destination in destinations {
            if let Some((node, _)) = self.entrances[destination] {
                if !needed[node] {
                    needed[node] = true;
                    remaining += 1;
                }
            }
        }
        self.search(
            self.entrances[origin]
                .into_iter()
                .map(|(node, cost)| (node, cost, None)),
            false,
            |node| {
                if needed[node] {
                    needed[node] = false;
                    remaining -= 1;
                }
                remaining == 0
            },
        )
    }
    /// Many economic origins ask for costs on one fixed network. Their
    /// searches share packed adjacency and scratch space; no journeys need
    /// to be reconstructed for these queries.
    pub fn distance_queries(&self) -> DistanceQueries<'_> {
        let mut offsets = Vec::with_capacity(self.edges.len() + 1);
        let mut arcs = Vec::new();
        for adjacent in &self.edges {
            offsets.push(arcs.len());
            arcs.extend(adjacent.iter().map(|edge| (edge.to, edge.cost)));
        }
        offsets.push(arcs.len());
        DistanceQueries {
            entrances: &self.entrances,
            offsets,
            arcs,
            costs: vec![f64::INFINITY; self.edges.len()],
            heap: KeyedHeap::new([Direction::Ascending], Direction::Ascending),
        }
    }
    /// The shortest walked course from each door to any traversable named way.
    pub fn to_streets(&self) -> Routes<'_> {
        let roots = self.edges.iter().enumerate().filter_map(|(node, edges)| {
            edges.iter().find_map(|edge| match edge.course {
                Course::Street(stretch) => Some((node, 0., Some(stretch.street))),
                _ => None,
            })
        });
        self.search(roots, true, |_| false)
    }
    fn search(
        &self,
        roots: impl Iterator<Item = (usize, f64, Option<usize>)>,
        walk_only: bool,
        mut finished: impl FnMut(usize) -> bool,
    ) -> Routes<'_> {
        let mut routes = Routes {
            graph: self,
            costs: vec![f64::INFINITY; self.edges.len()],
            via: vec![None; self.edges.len()],
            streets: vec![None; self.edges.len()],
        };
        let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
        for (start, offset, street) in roots {
            routes.costs[start] = offset;
            routes.streets[start] = street;
            heap.push(start as u32, [offset]);
        }
        while let Some((id, [cost])) = heap.pop() {
            let id = id as usize;
            if cost > routes.costs[id] {
                continue;
            }
            if finished(id) {
                break;
            }
            for edge in &self.edges[id] {
                if walk_only && !matches!(edge.course, Course::Walk) {
                    continue;
                }
                let next = cost + edge.cost;
                if next < routes.costs[edge.to] {
                    routes.costs[edge.to] = next;
                    routes.via[edge.to] = Some((id, edge.course));
                    routes.streets[edge.to] = routes.streets[id];
                    heap.push(edge.to as u32, [next]);
                }
            }
        }
        routes
    }
}
pub struct DistanceQueries<'a> {
    entrances: &'a [Option<(usize, f64)>],
    offsets: Vec<usize>,
    arcs: Vec<(usize, f64)>,
    costs: Vec<f64>,
    heap: KeyedHeap,
}
impl DistanceQueries<'_> {
    pub fn from(&mut self, origin: usize) {
        self.costs.fill(f64::INFINITY);
        let Some((start, offset)) = self.entrances[origin] else {
            return;
        };
        self.costs[start] = offset;
        self.heap.push(start as u32, [offset]);
        while let Some((node, [cost])) = self.heap.pop() {
            let node = node as usize;
            if cost > self.costs[node] {
                continue;
            }
            for &(next, length) in &self.arcs[self.offsets[node]..self.offsets[node + 1]] {
                let candidate = cost + length;
                if candidate < self.costs[next] {
                    self.costs[next] = candidate;
                    self.heap.push(next as u32, [candidate]);
                }
            }
        }
    }

    pub fn cost(&self, target: usize) -> f64 {
        self.entrances[target].map_or(f64::INFINITY, |(node, offset)| self.costs[node] + offset)
    }
}
pub struct Routes<'a> {
    graph: &'a BoundNetwork,
    costs: Vec<f64>,
    via: Vec<Option<(usize, Course)>>,
    streets: Vec<Option<usize>>,
}
impl Routes<'_> {
    pub fn cost(&self, target: usize) -> f64 {
        self.graph.entrances[target].map_or(f64::INFINITY, |(v, offset)| self.costs[v] + offset)
    }
    pub fn visit(&self, target: usize, mut traversed: impl FnMut(Stretch)) {
        self.course(target, |kind, _, _| {
            if let Course::Street(s) = kind {
                traversed(s)
            }
        });
    }
    pub fn course(&self, target: usize, mut traversed: impl FnMut(Course, Point, Point)) {
        let Some((mut node, _)) = self.graph.entrances[target] else {
            return;
        };
        while let Some((previous, kind)) = self.via[node] {
            traversed(kind, self.graph.points[node], self.graph.points[previous]);
            node = previous;
        }
    }
    pub fn approach(&self, target: usize) -> Option<Approach> {
        let (node, _) = self.graph.entrances[target]?;
        let street = self.streets[node]?;
        let mut points = vec![self.graph.points[node]];
        self.course(target, |_, _, b| points.push(b));
        Some(Approach { points, street })
    }
}
