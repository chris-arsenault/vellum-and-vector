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
        for transfer in town.kernel_links() {
            network.add_link(transfer.ends[0], transfer.ends[1], transfer.cost, spatial)?;
        }
        network.link_wet_holdings(town, spatial)?;
        Ok(network)
    }
    /// Adjacent occupied hulls share a gangway. Submerged dwellings use short
    /// passages within their own stratum and reach land through the transfer.
    fn link_wet_holdings(&mut self, town: &Town, spatial: &dyn SpatialKernel) -> io::Result<()> {
        use super::templates::Habitat;
        if !town
            .founding_sites
            .iter()
            .any(|&(_, id)| town.holdings()[id.0 as usize].slot.habitat.wet())
        {
            return Ok(());
        }
        for habitat in [Habitat::Floating, Habitat::Submerged] {
            let holdings: Vec<_> = town
                .holdings()
                .iter()
                .filter(|h| h.slot.habitat == habitat && h.condition > 0.2)
                .collect();
            if holdings.len() < 2 {
                continue;
            }
            let points: Vec<_> = holdings.iter().map(|h| pos(h.slot.front)).collect();
            let mut edges = spatial.delaunay_edges(&points).map_err(io::Error::other)?;
            if edges.is_empty() {
                let mut ordered: Vec<_> = (0..points.len()).collect();
                // hpc-exempt: order a line of actual hull entrances when no triangulation exists.
                ordered.sort_by(|&a, &b| {
                    holdings[a]
                        .slot
                        .front
                        .partial_cmp(&holdings[b].slot.front)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                edges.extend(ordered.windows(2).map(|pair| [pair[0], pair[1]]));
            }
            for [a, b] in edges {
                let (first, second) = (&holdings[a].slot, &holdings[b].slot);
                let span = distance(first.front, second.front);
                if span <= first.depth + second.depth {
                    self.add_link(first.front, second.front, span, spatial)?;
                }
            }
        }
        Ok(())
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
    /// Each `(source, target, cost)` journey on foot no dearer than `reach`; a pair it does
    /// not name is out of reach. Each search stops at the reach.
    pub fn reached_within(
        &self,
        sources: &[Point],
        targets: &[Point],
        reach: f64,
        spatial: &dyn SpatialKernel,
        mut visit: impl FnMut(usize, usize, f64),
    ) -> io::Result<()> {
        let locations: Vec<_> = sources
            .iter()
            .chain(targets)
            .copied()
            .map(Entrance::external)
            .collect();
        let graph = self.bind(&locations, AccessUse::Foot, spatial)?;
        let mut queries = graph.distance_queries();
        let destinations = queries.destinations((0..targets.len()).map(|t| (sources.len() + t, t)));
        for source in 0..sources.len() {
            queries.within(source, reach);
            queries.reached(&destinations, reach, |target, cost| {
                visit(source, target, cost)
            });
        }
        Ok(())
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
        self.connect_links(places, &mut graph);
        for path in retained {
            let [a, b] = path.points;
            let start = graph.vertex(a);
            let end = graph.vertex(b);
            let effort = 1. + (walking::EFFORT - 1.) / (1. + path.wear);
            graph.connect(start, end, distance(a, b) * effort, Course::Walk);
        }
        Ok(graph)
    }
    fn connect_links(&self, places: &[Entrance], graph: &mut BoundNetwork) {
        // Link landings are genuine entrance vertices even on water or where
        // no ordinary street is present. Only an exact landing can board.
        let mut landings = BTreeMap::new();
        for (i, (start, finish, cost)) in self.links.iter().enumerate() {
            let end = places.len() + 2 * i;
            let a = graph.vertex(*start);
            let b = graph.vertex(*finish);
            for (offset, p, node) in [(0, *start, a), (1, *finish, b)] {
                landings.insert(JunctionId::at(p), node);
                if let Some((attached, walk)) = graph.entrances[end + offset] {
                    if attached != node {
                        graph.connect(attached, node, walk, Course::Walk);
                    }
                }
            }
            graph.connect(a, b, *cost, Course::Link);
        }
        for (i, place) in places.iter().enumerate() {
            if let Some(&node) = landings.get(&JunctionId::at(place.point)) {
                graph.entrances[i] = Some((node, place.walk));
            }
        }
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
        // Each named street's legs, gathered once; an unnamed entrance may use any leg.
        let mut by_street =
            vec![Vec::new(); self.legs.iter().map(|l| l.street + 1).max().unwrap_or(0)];
        for (i, leg) in self.legs.iter().enumerate() {
            by_street[leg.street].push(i);
        }
        for (street, places) in groups {
            let indices: Vec<usize> = match street {
                Some(s) => by_street.get(s).cloned().unwrap_or_default(),
                None => (0..self.legs.len()).collect(),
            };
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
            Labels::dense(self.edges.len()),
            |_| false,
        )
    }
    /// Only the requested journeys are observable. Stop after settling their destinations.
    /// Such a search labels only the nodes it reaches, so its storage follows that reach
    /// rather than the whole network.
    pub(crate) fn routes_to(
        &self,
        origin: usize,
        destinations: impl Iterator<Item = usize>,
    ) -> Routes<'_> {
        // hpc-exempt: the few destination nodes one search still has to settle.
        let mut needed: std::collections::HashSet<usize> = destinations
            .filter_map(|destination| self.entrances[destination].map(|(node, _)| node))
            .collect();
        self.search(
            self.entrances[origin]
                .into_iter()
                .map(|(node, cost)| (node, cost, None)),
            false,
            Labels::Sparse(Default::default()),
            |node| {
                needed.remove(&node);
                needed.is_empty()
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
            touched: Vec::new(),
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
        self.search(roots, true, Labels::dense(self.edges.len()), |_| false)
    }
    fn search(
        &self,
        roots: impl Iterator<Item = (usize, f64, Option<usize>)>,
        walk_only: bool,
        mut labels: Labels,
        mut finished: impl FnMut(usize) -> bool,
    ) -> Routes<'_> {
        let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
        for (start, offset, street) in roots {
            labels.set(
                start,
                Label {
                    cost: offset,
                    via: None,
                    street,
                },
            );
            heap.push(start as u32, [offset]);
        }
        while let Some((id, [cost])) = heap.pop() {
            let id = id as usize;
            let here = labels.get(id);
            if cost > here.cost {
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
                if next < labels.get(edge.to).cost {
                    labels.set(
                        edge.to,
                        Label {
                            cost: next,
                            via: Some((id, edge.course)),
                            street: here.street,
                        },
                    );
                    heap.push(edge.to as u32, [next]);
                }
            }
        }
        Routes {
            graph: self,
            labels,
        }
    }
}
/// What a search knows about one node: its cost, the step it arrived by and the named
/// way it walks from.
#[derive(Clone, Copy)]
struct Label {
    cost: f64,
    via: Option<(usize, Course)>,
    street: Option<usize>,
}
const UNREACHED: Label = Label {
    cost: f64::INFINITY,
    via: None,
    street: None,
};
/// A search over the whole network keeps a label per node; one that stops at a few
/// destinations keeps only the nodes it labelled.
enum Labels {
    Dense(Vec<Label>),
    // hpc-exempt: the nodes an early-stopping search reached, keyed by node.
    Sparse(std::collections::HashMap<usize, Label>),
}
impl Labels {
    fn dense(nodes: usize) -> Self {
        Self::Dense(vec![UNREACHED; nodes])
    }
    fn get(&self, node: usize) -> Label {
        match self {
            Self::Dense(labels) => labels[node],
            Self::Sparse(labels) => labels.get(&node).copied().unwrap_or(UNREACHED),
        }
    }
    fn set(&mut self, node: usize, label: Label) {
        match self {
            Self::Dense(labels) => labels[node] = label,
            Self::Sparse(labels) => {
                labels.insert(node, label);
            }
        }
    }
}
pub struct DistanceQueries<'a> {
    entrances: &'a [Option<(usize, f64)>],
    offsets: Vec<usize>,
    arcs: Vec<(usize, f64)>,
    costs: Vec<f64>,
    /// The nodes the last search labelled, so the next search clears only those.
    touched: Vec<usize>,
    heap: KeyedHeap,
}
/// Destinations grouped by the network node their entrance joins, so a bounded search can
/// name the destinations it reached without looking at the others.
pub struct Destinations {
    offsets: Vec<usize>,
    entries: Vec<(usize, f64)>,
}
impl Destinations {
    fn at(&self, node: usize) -> &[(usize, f64)] {
        &self.entries[self.offsets[node]..self.offsets[node + 1]]
    }
}
impl DistanceQueries<'_> {
    pub fn from(&mut self, origin: usize) {
        self.within(origin, f64::INFINITY);
    }
    /// Costs from `origin` to every node no dearer than `reach`; dearer nodes stay unreached,
    /// and the search never visits them.
    pub fn within(&mut self, origin: usize, reach: f64) {
        for node in self.touched.drain(..) {
            self.costs[node] = f64::INFINITY;
        }
        let Some((start, offset)) = self.entrances[origin] else {
            return;
        };
        if offset > reach {
            return;
        }
        self.costs[start] = offset;
        self.touched.push(start);
        self.heap.push(start as u32, [offset]);
        while let Some((node, [cost])) = self.heap.pop() {
            let node = node as usize;
            if cost > self.costs[node] {
                continue;
            }
            for &(next, length) in &self.arcs[self.offsets[node]..self.offsets[node + 1]] {
                let candidate = cost + length;
                if candidate <= reach && candidate < self.costs[next] {
                    if self.costs[next] == f64::INFINITY {
                        self.touched.push(next);
                    }
                    self.costs[next] = candidate;
                    self.heap.push(next as u32, [candidate]);
                }
            }
        }
    }

    pub fn cost(&self, target: usize) -> f64 {
        self.entrances[target].map_or(f64::INFINITY, |(node, offset)| self.costs[node] + offset)
    }
    /// Index `(place, destination)` pairs by the node each place's entrance joins.
    pub fn destinations(&self, places: impl Iterator<Item = (usize, usize)>) -> Destinations {
        let nodes = self.costs.len();
        let joined: Vec<_> = places
            .filter_map(|(place, destination)| {
                self.entrances[place].map(|(node, offset)| (node, destination, offset))
            })
            .collect();
        let mut offsets = vec![0; nodes + 1];
        for &(node, ..) in &joined {
            offsets[node + 1] += 1;
        }
        for node in 0..nodes {
            offsets[node + 1] += offsets[node];
        }
        let mut next = offsets.clone();
        let mut entries = vec![(0, 0.); joined.len()];
        for (node, destination, offset) in joined {
            entries[next[node]] = (destination, offset);
            next[node] += 1;
        }
        Destinations { offsets, entries }
    }
    /// Each destination the last search reached within `reach`, with its travel cost.
    pub fn reached(
        &self,
        destinations: &Destinations,
        reach: f64,
        mut visit: impl FnMut(usize, f64),
    ) {
        for &node in &self.touched {
            let base = self.costs[node];
            for &(destination, offset) in destinations.at(node) {
                if base + offset <= reach {
                    visit(destination, base + offset);
                }
            }
        }
    }
}
pub struct Routes<'a> {
    graph: &'a BoundNetwork,
    labels: Labels,
}
impl Routes<'_> {
    pub fn cost(&self, target: usize) -> f64 {
        self.graph.entrances[target].map_or(f64::INFINITY, |(v, offset)| {
            self.labels.get(v).cost + offset
        })
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
        while let Some((previous, kind)) = self.labels.get(node).via {
            traversed(kind, self.graph.points[node], self.graph.points[previous]);
            node = previous;
        }
    }
    pub fn approach(&self, target: usize) -> Option<Approach> {
        let (node, _) = self.graph.entrances[target]?;
        let street = self.labels.get(node).street?;
        let mut points = vec![self.graph.points[node]];
        self.course(target, |_, _, b| points.push(b));
        Some(Approach { points, street })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Four junctions 10 m apart in a line, a place at each, the last 5 m from its junction.
    fn line() -> BoundNetwork {
        let mut graph = BoundNetwork::default();
        let nodes: Vec<_> = (0..4).map(|i| graph.vertex([i as f64 * 10., 0.])).collect();
        for pair in nodes.windows(2) {
            graph.connect(pair[0], pair[1], 10., Course::Walk);
        }
        graph.entrances = nodes.iter().map(|&n| Some((n, 0.))).collect();
        graph.entrances[3] = Some((nodes[3], 5.));
        graph
    }
    fn reached(
        queries: &DistanceQueries<'_>,
        destinations: &Destinations,
        reach: f64,
    ) -> Vec<(usize, f64)> {
        let mut found = Vec::new();
        queries.reached(destinations, reach, |d, cost| found.push((d, cost)));
        found.sort_by_key(|&(d, _)| d);
        found
    }
    #[test]
    fn a_bounded_search_names_only_destinations_within_reach() {
        let graph = line();
        let mut queries = graph.distance_queries();
        let destinations = queries.destinations((0..4).map(|place| (place, place)));
        queries.within(0, 25.);
        assert_eq!(
            reached(&queries, &destinations, 25.),
            [(0, 0.), (1, 10.), (2, 20.)]
        );
        assert_eq!(queries.cost(3), f64::INFINITY);
        // A destination's own approach counts against the reach.
        queries.within(0, 32.);
        assert_eq!(reached(&queries, &destinations, 32.).len(), 3);
        queries.from(0);
        assert_eq!(queries.cost(3), 35.);
        // A later, shorter search keeps nothing from the longer one before it.
        // Leaving and arriving at the last place both walk its 5 m approach.
        queries.within(3, 15.);
        assert_eq!(reached(&queries, &destinations, 15.), [(2, 15.), (3, 10.)]);
        assert_eq!(queries.cost(0), f64::INFINITY);
    }
}
