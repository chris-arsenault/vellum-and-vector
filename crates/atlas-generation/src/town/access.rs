//! Routes are rebuilt from noded streets and declared doors. Entrances split a stretch
//! for the current read while the measured street and its holding addresses retain their identity.
pub(crate) mod walking;
use super::{
    catalogue::AccessUse,
    fabric::{Endpoint, Holding, Town},
    geometry::{at, distance, Point},
    network::Street,
};
use crate::spatial::SpatialKernel;
use atlas_map::{Geometry, Position};
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BinaryHeap},
    io,
};

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
    #[serde(default)]
    pub beaten: bool,
}
impl Footpath {
    /// A beaten walking track remains narrow until investment builds a street.
    pub fn width(&self) -> f64 {
        0.7 * self.wear.clamp(0., 1.).sqrt()
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
#[derive(Clone, Copy, Debug)]
struct Leg {
    street: usize,
    segment: usize,
    width: f64,
    ends: [Point; 2],
}
/// A town's streets noded into legs between junctions: the costly part of an access network,
/// which a town keeps until its streets change.
#[derive(Debug, Default)]
pub struct Noded {
    legs: Vec<Leg>,
    geometries: Vec<Geometry>,
    /// Each named street's legs.
    by_street: Vec<Vec<usize>>,
}
impl Noded {
    pub(crate) fn street_groups(&self, count: usize) -> crate::hpc::UnionFind {
        let mut groups = crate::hpc::UnionFind::new(count);
        for i in 0..count {
            groups.make(i);
        }
        let mut at = BTreeMap::new(); // hpc-exempt: streets sharing a noded junction.
        for leg in &self.legs {
            for point in leg.ends {
                if let Some(other) = at.insert(JunctionId::at(point), leg.street) {
                    groups.union(leg.street, other);
                }
            }
        }
        groups
    }
    /// Bind walked vertices to actual surveyed streets, including mid-block arrivals.
    pub(crate) fn street_contacts(
        &self,
        streets: &[Street],
        nodes: impl Iterator<Item = JunctionId>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<BTreeMap<JunctionId, (usize, Point)>> {
        let index = spatial.index(&self.geometries).map_err(io::Error::other)?;
        let mut contacts = BTreeMap::new(); // hpc-exempt: junctions on the retained street network.
        for id in nodes {
            let p = id.point();
            let [x, y] = p;
            // Walked coordinates are rounded to millimetres.
            let b = atlas_map::Bounds(x - 0.001, y - 0.001, x + 0.001, y + 0.001);
            let hits = index.distances(b, pos(p)).map_err(io::Error::other)?;
            if let Some((i, _)) = hits
                .into_iter()
                .filter(|(_, d)| *d <= 0.001)
                .min_by(|a, b| a.1.total_cmp(&b.1))
            {
                let point = atlas_map::regions::point(pos(p));
                let leg = self.legs[i];
                let original =
                    super::edits::line(&streets[leg.street].points[leg.segment..=leg.segment + 1]);
                let [on, _] = spatial
                    .nearest_points(&original, &point)
                    .map_err(io::Error::other)?;
                contacts.insert(id, (leg.street, xy(on)));
            }
        }
        Ok(contacts)
    }
    /// A fingerprint of what noding reads: every street's points and widths.
    pub fn key(streets: &[Street]) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        streets.len().hash(&mut hasher);
        for street in streets {
            street.points.len().hash(&mut hasher);
            for [x, y] in &street.points {
                (x.to_bits(), y.to_bits()).hash(&mut hasher);
            }
            for width in &street.widths {
                width.to_bits().hash(&mut hasher);
            }
        }
        hasher.finish()
    }
}
pub struct Access<'a> {
    noded: std::rc::Rc<Noded>,
    links: Vec<(Point, Point, f64)>,
    ground: Option<&'a super::ground::Ground>,
    paths: &'a [Footpath],
    connections: Vec<[f64; 3]>,
    water_stages: Vec<(Point, f64)>,
    /// The scale the network's widths are read at: which ways carry which uses.
    scale: super::scale::TownScale,
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
        let mut network = Self::over(town.noded_streets(spatial)?, town.scale());
        network.paths = town.footpaths();
        network.connections.resize(town.streets().len(), [0.; 3]);
        for h in town.holdings().iter().filter(|h| h.occupation > 0.) {
            for kind in std::iter::once(h.kind).chain(h.secondary) {
                for connection in h.effects_as(kind).connects {
                    let strength = h.occupation * h.condition * connection.strength;
                    if connection.kind == AccessUse::Waterborne {
                        network.water_stages.push((h.slot.front, strength));
                    } else if let Some(on_street) =
                        h.slot.street.and_then(|i| network.connections.get_mut(i))
                    {
                        on_street[connection.kind as usize] += strength;
                    }
                }
            }
        }
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
    /// A network over streets laid at street fidelity.
    pub fn new(streets: &[Street], spatial: &dyn SpatialKernel) -> io::Result<Self> {
        Ok(Self::over(
            std::rc::Rc::new(Self::node(streets, spatial)?),
            super::scale::TownScale::default(),
        ))
    }
    /// The town's streets alone, without its footpaths and links, from its held noding.
    pub fn over_town_streets(town: &Town, spatial: &dyn SpatialKernel) -> io::Result<Self> {
        Ok(Self::over(town.noded_streets(spatial)?, town.scale()))
    }
    fn over(noded: std::rc::Rc<Noded>, scale: super::scale::TownScale) -> Self {
        Self {
            noded,
            links: vec![],
            ground: None,
            paths: &[],
            connections: Vec::new(),
            water_stages: Vec::new(),
            scale,
        }
    }
    /// The streets noded at their crossings into legs, each kept with the street it is part of.
    pub fn node(streets: &[Street], spatial: &dyn SpatialKernel) -> io::Result<Noded> {
        let mut access = Noded::default();
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
                    .enumerate()
                    .filter(|(_, (p, _))| JunctionId::at(p[0]) != JunctionId::at(p[1]))
                    .map(move |(segment, (p, w))| {
                        (
                            Leg {
                                street,
                                segment,
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
        access.by_street =
            vec![Vec::new(); access.legs.iter().map(|l| l.street + 1).max().unwrap_or(0)];
        for (i, leg) in access.legs.iter().enumerate() {
            access.by_street[leg.street].push(i);
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
        let mut links = self.links.clone();
        if let Some(ground) = self.ground.filter(|_| mode == AccessUse::Waterborne) {
            self.water_connections(ground, spatial, &mut links)?;
        }
        for (a, b, _) in &links {
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
        Self::connect_links(&links, places, &mut graph);
        for path in retained {
            let [a, b] = path.points;
            let start = graph.vertex(a);
            let end = graph.vertex(b);
            let effort = 1. + (walking::EFFORT - 1.) / (1. + path.wear);
            let cost = self
                .ground
                .map_or(distance(a, b) * effort, |g| walking::cost(g, a, b, effort));
            graph.connect(start, end, cost, Course::Walk);
        }
        Ok(graph)
    }
    fn connect_links(links: &[(Point, Point, f64)], places: &[Entrance], graph: &mut BoundNetwork) {
        // Link landings are genuine entrance vertices even on water or where
        // no ordinary street is present. Only an exact landing can board.
        let mut landings = BTreeMap::new();
        for (i, (start, finish, cost)) in links.iter().enumerate() {
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
        let noded = self.noded.clone();
        let mut cuts: Vec<Vec<(f64, Point)>> = noded
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
        // An entrance on a named street uses that street's legs; an unnamed one may use any.
        for (street, places) in groups {
            let indices: Vec<usize> = match street {
                Some(s) => noded.by_street.get(s).cloned().unwrap_or_default(),
                None => (0..noded.legs.len()).collect(),
            };
            if indices.is_empty() {
                continue;
            }
            let shapes: Vec<_> = indices
                .iter()
                .map(|&i| noded.geometries[i].clone())
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
                if !mode.permits_width(noded.legs[segment].width, self.scale) {
                    continue;
                }
                let entrance = entries[i];
                let projected = xy(spatial
                    .nearest_points(
                        &Geometry::Point {
                            coordinates: pos(entrance.point),
                        },
                        &noded.geometries[segment],
                    )
                    .map_err(io::Error::other)?[1]);
                cuts[segment].push((distance(noded.legs[segment].ends[0], projected), projected));
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
        for (leg, mut cuts) in self.noded.legs.iter().zip(cuts) {
            if !mode.permits_width(leg.width, self.scale) {
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
                let assistance = self
                    .connections
                    .get(leg.street)
                    .map_or(0., |s| s[mode as usize]);
                graph.connect(
                    a,
                    b,
                    stretch.length() / (1. + assistance),
                    Course::Street(stretch),
                );
            }
        }
    }
    fn water_connections(
        &self,
        ground: &super::ground::Ground,
        spatial: &dyn SpatialKernel,
        links: &mut Vec<(Point, Point, f64)>,
    ) -> io::Result<()> {
        let positions: Vec<_> = self
            .water_stages
            .iter()
            .map(|(point, _)| pos(*point))
            .collect();
        if positions.len() < 2 {
            return Ok(());
        }
        let mut edges = spatial
            .delaunay_edges(&positions)
            .map_err(io::Error::other)?;
        if edges.is_empty() && positions.len() == 2 {
            edges.push([0, 1]);
        }
        for [a, b] in edges {
            let (from, first) = self.water_stages[a];
            let (to, second) = self.water_stages[b];
            let span = distance(from, to);
            if span > ground.cell
                && ground.wet_runs(&[from, to]).iter().any(|&(start, end)| {
                    start <= 2. * ground.cell && span - end <= 2. * ground.cell
                })
            {
                links.push((from, to, span / (1. + first.min(second))));
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
                graph.connect(
                    door,
                    road,
                    walking::cost(ground, entrance.point, projected, walking::EFFORT),
                    Course::Walk,
                );
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
    components: std::cell::OnceCell<Vec<usize>>,
}
impl BoundNetwork {
    /// Movement has already surveyed these vertices and noded the new street.
    /// Include its actual length in further journeys during this investment round.
    pub(crate) fn add_public_street(&mut self, id: usize, street: &Street) {
        for pair in street.points.windows(2) {
            let a = self.vertex(pair[0]);
            let b = self.vertex(pair[1]);
            if a != b {
                self.connect(
                    a,
                    b,
                    distance(pair[0], pair[1]),
                    Course::Street(Stretch::between(id, pair[0], pair[1])),
                );
            }
        }
    }
    pub(crate) fn junction_cost(&self, from: Point, to: Point) -> Option<f64> {
        let &a = self.vertices.get(&JunctionId::at(from))?;
        let &b = self.vertices.get(&JunctionId::at(to))?;
        let routes = self.search(
            [(a, 0., None)].into_iter(),
            false,
            Labels::Sparse(Default::default()),
            |id| id == b,
        );
        Some(routes.labels.get(b).cost)
    }
    pub(crate) fn connect_door(&mut self, index: usize, point: Point, porch: usize, cost: f64) {
        if let Some((outside, _)) = self.entrances[porch] {
            let door = self.vertex(point);
            self.connect(door, outside, cost, Course::Walk);
            self.entrances[index] = Some((door, 0.));
        }
    }
    pub(crate) fn exclude_walks(&mut self, blocked: &std::collections::BTreeSet<[JunctionId; 2]>) {
        self.components.take();
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
            self.components.take();
            self.edges.push(vec![]);
            self.points.push(p);
            self.edges.len() - 1
        })
    }
    fn connect(&mut self, a: usize, b: usize, cost: f64, course: Course) {
        self.components.take();
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
        let origin = self.entrances[origin];
        let components = self.components.get_or_init(|| {
            let mut regions = vec![usize::MAX; self.edges.len()];
            let mut pending = Vec::new();
            for start in 0..regions.len() {
                if regions[start] != usize::MAX {
                    continue;
                }
                regions[start] = start;
                pending.push(start);
                while let Some(node) = pending.pop() {
                    for next in &self.edges[node] {
                        if regions[next.to] == usize::MAX {
                            regions[next.to] = start;
                            pending.push(next.to);
                        }
                    }
                }
            }
            regions
        });
        // An unreachable destination otherwise makes every traveller explore
        // their entire district even after reaching every connected stop.
        let region = origin.map(|(node, _)| components[node]);
        // hpc-exempt: the few destination nodes one search still has to settle.
        let mut needed: std::collections::HashSet<usize> = destinations
            .filter_map(|destination| self.entrances[destination].map(|(node, _)| node))
            .filter(|&node| Some(components[node]) == region)
            .collect();
        self.search(
            origin.into_iter().map(|(node, cost)| (node, cost, None)),
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
        let mut legs = Vec::new();
        for (node, adjacent) in self.edges.iter().enumerate() {
            offsets.push(arcs.len());
            legs.clear();
            legs.extend(
                adjacent
                    .iter()
                    .filter(|edge| edge.to != node)
                    .map(|edge| (edge.to, edge.cost)),
            );
            // A worn path, street and walking mesh can join the same two doors.
            // The mode was applied at binding; only the cheapest permitted leg matters here.
            legs.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.total_cmp(&b.1)));
            legs.dedup_by_key(|edge| edge.0);
            arcs.extend_from_slice(&legs);
        }
        offsets.push(arcs.len());
        DistanceQueries {
            entrances: &self.entrances,
            offsets,
            arcs,
            costs: vec![f64::INFINITY; self.edges.len()],
            touched: Vec::new(),
            pending: DistanceQueue::default(),
            last_search: None,
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
        let mut heap = CostQueue::default();
        for (start, offset, street) in roots {
            labels.set(
                start,
                Label {
                    cost: offset,
                    via: None,
                    street,
                },
            );
            heap.push(start, offset);
        }
        while let Some((id, cost)) = heap.pop() {
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
                    heap.push(edge.to, next);
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
/// Nonnegative travel costs have the same ordering as their IEEE bit patterns.
/// Store cost and junction together so the heap moves them in a single sift.
#[derive(Default)]
struct CostQueue(BinaryHeap<Reverse<(u64, usize)>>);
impl CostQueue {
    fn push(&mut self, node: usize, cost: f64) {
        debug_assert!(cost >= 0.);
        self.0.push(Reverse((cost.abs().to_bits(), node)));
    }
    fn pop(&mut self) -> Option<(usize, f64)> {
        self.0
            .pop()
            .map(|Reverse((cost, node))| (node, f64::from_bits(cost)))
    }
}
/// Distances within a finite reach can be processed in bands. A cheaper arrival queues the
/// junction again, including within its current band. Nonnegative legs can never enter an
/// earlier band, so draining each band settles its costs without ordering its individual doors.
#[derive(Default)]
struct DistanceQueue {
    bands: Vec<Vec<(usize, f64)>>,
    current: usize,
    bands_per_unit: f64,
    unbounded: CostQueue,
}
impl DistanceQueue {
    fn start(&mut self, reach: f64) {
        const BANDS: usize = 256;
        self.current = 0;
        self.bands_per_unit = 0.;
        if reach.is_finite() && reach > 0. {
            self.bands.resize_with(BANDS, Vec::new);
            self.bands_per_unit = BANDS as f64 / reach;
        }
    }
    fn push(&mut self, node: usize, cost: f64) {
        if self.bands_per_unit == 0. {
            self.unbounded.push(node, cost);
        } else {
            let band = ((cost * self.bands_per_unit) as usize).min(self.bands.len() - 1);
            self.bands[band].push((node, cost));
        }
    }
    fn pop(&mut self) -> Option<(usize, f64)> {
        if self.bands_per_unit == 0. {
            return self.unbounded.pop();
        }
        while let Some(band) = self.bands.get_mut(self.current) {
            if let Some(entry) = band.pop() {
                return Some(entry);
            }
            self.current += 1;
        }
        None
    }
}
pub struct DistanceQueries<'a> {
    entrances: &'a [Option<(usize, f64)>],
    offsets: Vec<usize>,
    arcs: Vec<(usize, f64)>,
    costs: Vec<f64>,
    /// The nodes the last search labelled, so the next search clears only those.
    touched: Vec<usize>,
    pending: DistanceQueue,
    last_search: Option<(usize, f64, f64)>,
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
    /// At a frontage only the best available offer for a commodity matters. Visit
    /// producers from highest capability to lowest. Once a previous producer can
    /// reach a junction at lower cost, it also beats this one on every continuation.
    pub(crate) fn improving_offers(
        &self,
        strongest_first: &[(usize, f64)],
        destinations: &Destinations,
        reach: f64,
        mut visit: impl FnMut(usize, f64, f64),
    ) {
        let mut nearest = vec![f64::INFINITY; self.costs.len()];
        let mut heap = CostQueue::default();
        for &(origin, capability) in strongest_first {
            let Some((start, approach)) = self.entrances[origin] else {
                continue;
            };
            if approach > reach || approach >= nearest[start] {
                continue;
            }
            nearest[start] = approach;
            heap.push(start, approach);
            while let Some((node, cost)) = heap.pop() {
                if cost > nearest[node] {
                    continue;
                }
                for &(site, offset) in destinations.at(node) {
                    if cost + offset <= reach {
                        visit(site, capability, cost + offset);
                    }
                }
                for &(next, length) in &self.arcs[self.offsets[node]..self.offsets[node + 1]] {
                    let arrival = cost + length;
                    if arrival <= reach && arrival < nearest[next] {
                        nearest[next] = arrival;
                        heap.push(next, arrival);
                    }
                }
            }
        }
    }

    /// Each reachable source and destination pair. Streets and links are undirected
    /// and both approach costs count, so the smaller set can supply the search roots.
    pub(crate) fn pairs_within(
        &mut self,
        sources: &[usize],
        destinations: &[usize],
        reach: f64,
        mut visit: impl FnMut(usize, usize, f64),
    ) {
        if sources.is_empty() || destinations.is_empty() {
            return;
        }
        let reverse = destinations.len() < sources.len();
        let (roots, leaves) = if reverse {
            (destinations, sources)
        } else {
            (sources, destinations)
        };
        let indexed = self.destinations(leaves.iter().map(|&place| (place, place)));
        for &root in roots {
            self.within(root, reach);
            self.reached(&indexed, reach, |leaf, cost| {
                if reverse {
                    visit(leaf, root, cost);
                } else {
                    visit(root, leaf, cost);
                }
            });
        }
    }
    pub fn from(&mut self, origin: usize) {
        self.within(origin, f64::INFINITY);
    }
    /// Costs from `origin` to every node no dearer than `reach`; dearer nodes stay unreached,
    /// and the search never visits them.
    pub fn within(&mut self, origin: usize, reach: f64) {
        // A workshop's goods, second business and ordinary work can all use
        // the same door. Their different identities share this distance tree.
        let search = self.entrances[origin].map(|(node, offset)| (node, offset, reach));
        if self.last_search == search {
            return;
        }
        self.last_search = search;
        for node in self.touched.drain(..) {
            self.costs[node] = f64::INFINITY;
        }
        let Some((start, offset, _)) = search else {
            return;
        };
        if offset > reach {
            return;
        }
        self.costs[start] = offset;
        self.touched.push(start);
        self.pending.start(reach);
        self.pending.push(start, offset);
        while let Some((node, cost)) = self.pending.pop() {
            if cost > self.costs[node] {
                continue;
            }
            for &(first, length) in &self.arcs[self.offsets[node]..self.offsets[node + 1]] {
                let (mut previous, mut next, mut candidate) = (node, first, cost + length);
                while candidate <= reach && candidate < self.costs[next] {
                    if self.costs[next] == f64::INFINITY {
                        self.touched.push(next);
                    }
                    self.costs[next] = candidate;
                    // Price every frontage and walking portal, but only queue a junction
                    // where the journey can branch. A cheaper arrival from the other end
                    // can still improve any part of the street.
                    match &self.arcs[self.offsets[next]..self.offsets[next + 1]] {
                        [] | [_] => break,
                        [a, b] => {
                            let &(onward, leg) = if a.0 == previous { b } else { a };
                            previous = next;
                            next = onward;
                            candidate += leg;
                        }
                        _ => {
                            self.pending.push(next, candidate);
                            break;
                        }
                    }
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
    fn a_nearby_weaker_supplier_can_beat_the_more_distant_stronger_offer() {
        let graph = line();
        let queries = graph.distance_queries();
        let sites = queries.destinations((0..4).map(|i| (i, i)));
        let mut best = [0_f64; 4];
        queries.improving_offers(
            &[(0, 2.), (3, 1.), (3, 0.5)],
            &sites,
            30.,
            |site, capability, cost| {
                best[site] = best[site].max(capability / (1. + cost / 10.));
            },
        );
        assert_eq!(best[0], 2.);
        assert_eq!(best[1], 1.);
        assert_eq!(best[2], 2. / 3.);
        // From the other end the final door is 35 m away. From its own
        // supplier the two approaches cost 10 m.
        assert_eq!(best[3], 0.5);
    }
    /// A town's noded streets are reused until a street's points or widths change.
    #[test]
    fn noded_streets_are_keyed_by_what_noding_reads() {
        use super::super::{network::Class, story::Size};
        let street = Street::new(vec![[0., 0.], [10., 0.]], Class::Lane, Size::Village);
        let crossing = Street::new(vec![[5., -5.], [5., 5.]], Class::Lane, Size::Village);
        let streets = vec![street.clone(), crossing.clone()];
        let key = Noded::key(&streets);
        assert_eq!(key, Noded::key(&streets.clone()));
        let mut wider = streets.clone();
        wider[0].widths[0] += 1.;
        assert_ne!(key, Noded::key(&wider));
        let mut moved = streets.clone();
        moved[1].points[1] = [5., 6.];
        assert_ne!(key, Noded::key(&moved));
        let mut named = streets.clone();
        named[0].destination = Some("Mill".into());
        assert_eq!(key, Noded::key(&named));
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
    #[test]
    fn frontage_costs_on_a_loop_include_transfers_and_every_door_approach() {
        let mut graph = BoundNetwork::default();
        for i in 0..9 {
            let node = graph.vertex([10. * i as f64, 0.]);
            graph.entrances.push(Some((node, i as f64 / 2.)));
        }
        // The last door is across an unbridged gap. Six others share a loop
        // with a faster transfer on one side and a dead end off the middle.
        for (a, b, cost) in [
            (0, 1, 6.),
            (1, 2, 6.),
            (2, 3, 6.),
            (3, 4, 6.),
            (4, 5, 6.),
            (5, 0, 2.),
            (3, 6, 1.),
            (6, 7, 2.),
        ] {
            graph.connect(a, b, cost, Course::Walk);
        }
        graph.connect(2, 1, 0.5, Course::Link);
        graph.connect(2, 2, 0., Course::Walk);
        let mut queries = graph.distance_queries();
        let sites = queries.destinations((0..9).map(|i| (i, i)));
        for source in 0..9 {
            let routes = graph.routes(source);
            for reach in [5., 12., 22., 50.] {
                queries.within(source, reach);
                let expected: Vec<_> = (0..9)
                    .map(|door| (door, routes.cost(door)))
                    .filter(|&(_, cost)| cost <= reach)
                    .collect();
                assert_eq!(reached(&queries, &sites, reach), expected);
            }
        }
    }
    #[test]
    fn a_zero_cost_transfer_reprices_a_junction_and_keeps_its_doors_in_caller_order() {
        let mut graph = BoundNetwork::default();
        for i in 0..7 {
            let node = graph.vertex([i as f64, 0.]);
            graph.entrances.push(Some((node, 0.)));
        }
        for (a, b, cost) in [
            (0, 1, 0.125),
            (0, 2, 0.75),
            (1, 2, 0.),
            (1, 3, 2.),
            (2, 4, 0.25),
            (2, 5, 255.875),
            (2, 6, 255.876),
        ] {
            graph.connect(a, b, cost, Course::Walk);
        }
        let mut queries = graph.distance_queries();
        let sites = queries.destinations([(5, 19), (6, 27), (5, 3), (5, 12)].into_iter());
        // In the first band the direct arrival at 2 can be expanded before the transfer.
        // Repricing 2 must reach the distant building exactly at the daily limit.
        queries.within(0, 256.);
        let mut doors = Vec::new();
        queries.reached(&sites, 256., |door, cost| doors.push((door, cost)));
        assert_eq!(doors, [(19, 256.), (3, 256.), (12, 256.)]);
        assert_eq!(queries.cost(4), 0.375);
        assert_eq!(queries.cost(6), f64::INFINITY);
        queries.from(0);
        assert!(queries.cost(6) > 256. && queries.cost(6) < 257.);
        queries.within(0, 0.);
        assert_eq!(queries.cost(2), f64::INFINITY);
    }
    #[test]
    fn distance_pairs_keep_door_offsets_and_directions_from_either_side() {
        let mut graph = line();
        graph.entrances.push(None);
        let mut queries = graph.distance_queries();
        let mut pairs = Vec::new();
        queries.pairs_within(&[0, 1, 2, 4], &[3], 25., |a, b, cost| {
            pairs.push((a, b, cost));
        });
        pairs.sort_by_key(|p| p.0);
        assert_eq!(pairs, [(1, 3, 25.), (2, 3, 15.)]);
        pairs.clear();
        queries.pairs_within(&[3], &[0, 1, 2, 4], 25., |a, b, cost| {
            pairs.push((a, b, cost));
        });
        pairs.sort_by_key(|p| p.1);
        assert_eq!(pairs, [(3, 1, 25.), (3, 2, 15.)]);
    }

    #[test]
    fn a_vacant_front_reads_the_same_competing_workplaces_from_either_door() {
        use super::super::{
            catalogue::Activity,
            fabric::Endpoint,
            influence::{
                frontage_support, household_demand_from_sites, Conditions, FrontageRead,
                OpportunitySource, Reading, SourceId,
            },
        };
        let mut graph = line();
        graph.entrances.push(graph.entrances[2]); // Second door at the same distance.
        graph.entrances.push(None); // A different, unreachable workplace.
        let source = |name: &str, demand| {
            let id = atlas_map::Id::from_name(name);
            OpportunitySource {
                endpoint: Endpoint::External(id),
                id: SourceId::Named(id),
                label: name.to_owned(),
                position: [0., 0.],
                activity: Activity::Production,
                demand,
                capability: 0.,
                productive: None,
                clientele: None,
            }
        };
        let sources = [
            source("mill", 10.),
            source("mill", 0.),
            source("market", 6.),
            source("inn", 4.),
            source("market", 100.),
            source("island", 50.),
        ];
        let sites = [0, 3];
        let conditions = [Conditions::default(); 2];
        let reading = Reading {
            sites: &conditions,
            scale: Default::default(),
        };
        let competitors = |s: &OpportunitySource| f64::from(s.demand == 6.) * 2.;
        let mut paths = graph.distance_queries();
        let reverse =
            household_demand_from_sites(&sources, competitors, reading, &sites, &mut paths)
                .unwrap();
        let forward = frontage_support(
            &sources,
            competitors,
            |_| 0.,
            FrontageRead::HouseholdDemand,
            reading,
            |origin, visit| {
                paths.from(origin);
                for (site, &entrance) in sites.iter().enumerate() {
                    visit(site, paths.cost(entrance));
                }
            },
        );
        for (a, b) in forward.iter().zip(&reverse) {
            let a = a.for_activity(Activity::Household).demand;
            let b = b.for_activity(Activity::Household).demand;
            assert!((a - b).abs() < 1e-10);
        }
        assert!(
            reverse[0].for_activity(Activity::Household).demand
                > reverse[1].for_activity(Activity::Household).demand
        );
        assert!(household_demand_from_sites(
            &sources[..1],
            competitors,
            reading,
            &sites,
            &mut paths
        )
        .is_none());
    }
    #[test]
    fn journeys_to_a_separate_road_respond_to_opening_and_closing_a_path() {
        let mut graph = line();
        let p = [50., 0.];
        let island = graph.vertex(p);
        graph.entrances.push(Some((island, 0.)));
        let routes = graph.routes_to(0, [1, 4].into_iter());
        assert_eq!(routes.cost(1), 10.);
        assert!(!routes.cost(4).is_finite());
        // The disconnected destination does not force a search past the first stop.
        assert!(!routes.cost(3).is_finite());
        let end = graph.entrances[3].unwrap().0;
        graph.connect(end, island, 20., Course::Walk);
        assert_eq!(graph.routes_to(0, [4].into_iter()).cost(4), 50.);
        let key = super::super::fabric::walks::path_key([30., 0.], p);
        graph.exclude_walks(&[key].into());
        assert!(!graph.routes_to(0, [4].into_iter()).cost(4).is_finite());
    }
}
