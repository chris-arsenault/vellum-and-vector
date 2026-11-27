use super::{HoldingId, Town};
use crate::town::{
    access::{walking, Access, Approach, BoundNetwork, Entrance, Footpath, JunctionId},
    catalogue::AccessUse,
    edits::line,
    geometry::{distance, Point},
    ground::{Ground, FREE, PLOT},
};
use atlas_map::{
    spatial::{Overlay, SpatialIndex, SpatialKernel},
    Bounds, Geometry,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
};

pub(crate) fn path_key(a: Point, b: Point) -> [JunctionId; 2] {
    let a = JunctionId::at(a);
    let b = JunctionId::at(b);
    [a.min(b), a.max(b)]
}
struct Roofs<'a> {
    spatial: &'a dyn SpatialKernel,
    index: Box<dyn SpatialIndex + 'a>,
    shapes: Vec<Geometry>,
    // hpc-exempt: routes sharing a physical stretch reuse its exact footprint intersection.
    checked: BTreeMap<[JunctionId; 2], bool>,
}
impl<'a> Roofs<'a> {
    fn new(town: &Town, spatial: &'a dyn SpatialKernel) -> io::Result<Self> {
        let shapes: Vec<_> = town
            .holdings()
            .iter()
            .filter(|h| {
                h.slot
                    .habitat
                    .shares_surface(crate::town::templates::Habitat::Ground)
            })
            .flat_map(|h| h.buildings.iter().cloned())
            .collect();
        Ok(Self {
            index: spatial.index(&shapes).map_err(io::Error::other)?,
            shapes,
            spatial,
            checked: BTreeMap::new(),
        })
    }
    fn blocks(&mut self, [a, b]: [JunctionId; 2]) -> io::Result<bool> {
        if let Some(blocked) = self.checked.get(&[a, b]) {
            return Ok(*blocked);
        }
        let [p, q] = [a.point(), b.point()];
        let trace = line(&[p, q]);
        let bounds = Bounds(
            p[0].min(q[0]),
            p[1].min(q[1]),
            p[0].max(q[0]),
            p[1].max(q[1]),
        );
        let mut blocked = false;
        for i in self.index.query(bounds).map_err(io::Error::other)? {
            if let Some(crossed) = self
                .spatial
                .overlay(&trace, &self.shapes[i], Overlay::Intersection)
                .map_err(io::Error::other)?
            {
                if self.spatial.length(&crossed).map_err(io::Error::other)? > 0.001 {
                    blocked = true;
                    break;
                }
            }
        }
        self.checked.insert([a, b], blocked);
        Ok(blocked)
    }
    fn blocked_legs(
        &mut self,
        route: &Approach,
        blocked: &mut BTreeSet<[JunctionId; 2]>,
    ) -> io::Result<bool> {
        let mut obstructed = false;
        for pair in route.points.windows(2) {
            let key = path_key(pair[0], pair[1]);
            if key[0] != key[1] && self.blocks(key)? {
                blocked.insert(key);
                obstructed = true;
            }
        }
        Ok(obstructed)
    }
}
impl Town {
    /// Give each built premise a physically passable approach after this round's construction.
    /// A new connection has no accumulated traffic. Movement supplies its wear.
    pub fn resolve_approaches(
        &mut self,
        ground: &Ground,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        let mut roofs = Roofs::new(self, spatial)?;
        let mut paths = BTreeMap::new(); // hpc-exempt: one beaten path per physical stretch.
        for path in &self.footpaths {
            let key = path_key(path.points[0], path.points[1]);
            if !roofs.blocks(key)? {
                paths.insert(key, *path);
            }
        }
        self.footpaths = paths.values().copied().collect();
        self.approaches.resize(self.holdings.len(), None);
        let mut blocked = BTreeSet::new(); // hpc-exempt: remove segments across an actual roof from the walking graph.
        for approach in &mut self.approaches {
            if let Some(route) = approach {
                if roofs.blocked_legs(route, &mut blocked)? {
                    *approach = None;
                }
            }
        }
        if self.streets.is_empty() {
            return Ok(());
        }
        let missing: Vec<_> = self
            .holdings
            .iter()
            .filter(|h| {
                (h.slot.street.is_none() || h.access_via.is_some())
                    && (h.public || h.outdoor || !h.buildings.is_empty())
                    && self.approach(h.id).is_none()
            })
            .map(|h| (h.id, h.slot.front))
            .collect();
        if !missing.is_empty() {
            let graph = door_network(self, &missing, ground, spatial)?;
            for (id, approach) in physical_routes(graph, &missing, &mut roofs)? {
                self.approaches[id.0 as usize] = Some(approach);
            }
        }
        for route in self.approaches.iter().flatten() {
            retain_path(route, &mut paths);
        }
        self.footpaths = paths.into_values().collect();
        Ok(())
    }
}
// hpc-exempt: each retained walking stretch has one physical geometry.
fn retain_path(route: &Approach, paths: &mut BTreeMap<[JunctionId; 2], Footpath>) {
    for p in route.points.windows(2) {
        let [a, b] = path_key(p[0], p[1]);
        if a != b {
            paths.entry([a, b]).or_insert(Footpath {
                points: [a.point(), b.point()],
                wear: 0.,
                beaten: false,
            });
        }
    }
}

fn door_network(
    town: &Town,
    missing: &[(HoldingId, Point)],
    ground: &Ground,
    spatial: &dyn SpatialKernel,
) -> io::Result<BoundNetwork> {
    let mut entrances: Vec<_> = missing
        .iter()
        .map(|(_, p)| Entrance::independent(*p))
        .collect();
    let mut porches = Vec::new();
    // A door outside a roof can lie in a cell whose centre is inside it. Join
    // its immediate open neighbours; exact geometry checks these short links.
    for (index, &(_, p)) in missing
        .iter()
        .enumerate()
        .filter(|(_, (_, p))| ground.owner(*p) == PLOT)
    {
        let cell = ground.cell;
        for i in ground.cells_within([p[0] - cell, p[1] - cell, p[0] + cell, p[1] + cell]) {
            if ground.owner_at(i) != FREE {
                continue;
            }
            let q = ground.centre(i);
            // A diagonal escape crosses a cell corner. Withhold wall, water
            // and hillside there; roof edges use the exact polygon check.
            if [[p[0], q[1]], [q[0], p[1]]]
                .iter()
                .any(|&r| !matches!(ground.owner(r), FREE | PLOT))
            {
                continue;
            }
            porches.push((index, p, entrances.len(), distance(p, q) * walking::EFFORT));
            entrances.push(Entrance::independent(q));
        }
    }
    for street in town.streets() {
        entrances.extend(
            street
                .points
                .first()
                .into_iter()
                .chain(street.points.last())
                .copied()
                .map(Entrance::external),
        );
    }
    let mut graph = Access::for_town(town, spatial)?.on_ground(ground).bind(
        &entrances,
        AccessUse::Foot,
        spatial,
    )?;
    for (door, p, porch, cost) in porches {
        graph.connect_door(door, p, porch, cost);
    }
    Ok(graph)
}
fn physical_routes(
    mut graph: BoundNetwork,
    missing: &[(HoldingId, Point)],
    roofs: &mut Roofs<'_>,
) -> io::Result<Vec<(HoldingId, Approach)>> {
    let mut pending: Vec<_> = missing
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (i, *id))
        .collect();
    let mut resolved = Vec::new();
    while !pending.is_empty() {
        let routes = graph.to_streets();
        let mut blocked = BTreeSet::new(); // hpc-exempt: share confirmed geometric obstructions across every door's shortest path.
        let mut retry = Vec::new();
        for (i, id) in pending {
            let Some(route) = routes.approach(i) else {
                continue;
            };
            if roofs.blocked_legs(&route, &mut blocked)? {
                retry.push((i, id));
            } else {
                resolved.push((id, route));
            }
        }
        graph.exclude_walks(&blocked);
        pending = retry;
    }
    Ok(resolved)
}
