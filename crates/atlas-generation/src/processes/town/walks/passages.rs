//! Continuous shared walks that could join two occupied street networks.
use super::{JunctionId, LaneCourse, Worn};
use crate::{
    hpc::UnionFind,
    spatial::SpatialKernel,
    town::{
        edits::line,
        fabric::Town,
        geometry::{distance, Point},
        network::Class,
    },
};
use atlas_map::{Bounds, Position};
use std::{
    cmp::Reverse,
    // hpc-exempt: sparse identities of contacted streets and walked junctions.
    collections::{BTreeMap, BinaryHeap},
    io,
};

pub(in crate::processes::town) struct StreetGroups {
    groups: UnionFind,
    streets: usize,
}
impl StreetGroups {
    /// Only a completed street can join two previously separate neighbourhoods.
    pub fn separate(
        &mut self,
        ends: [usize; 2],
        town: &Town,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        for i in self.streets..town.streets().len() {
            self.groups.push_active();
            let way = line(&town.streets()[i].points);
            let Bounds(w, s, e, n) = spatial.bounds(&way).map_err(io::Error::other)?;
            let tol = 0.001;
            let b = Bounds(w - tol, s - tol, e + tol, n + tol);
            for j in town
                .nearby_roads(b, spatial)?
                .into_iter()
                .filter(|&j| j < i)
            {
                let other = line(&town.streets()[j].points);
                if spatial.distance(&way, &other).map_err(io::Error::other)? <= tol {
                    self.groups.union(i, j);
                }
            }
        }
        self.streets = town.streets().len();
        Ok(self.groups.find(ends[0]) != self.groups.find(ends[1]))
    }
}

/// Each shared walking stretch enters one search, even when thousands of doors
/// enter the network. Two expanding street networks meet on the shortest worn link.
pub(in crate::processes::town) fn propose(
    town: &Town,
    worn: &Worn,
    spatial: &dyn SpatialKernel,
    paths: &mut Vec<LaneCourse>,
) -> io::Result<Option<StreetGroups>> {
    if worn.is_empty() || town.streets().len() < 2 {
        return Ok(None);
    }
    let noded = town.noded_streets(spatial)?;
    let mut groups = noded.street_groups(town.streets().len());
    if groups.size(0) == town.streets().len() {
        return Ok(None);
    }
    let mut neighbours = BTreeMap::<_, Vec<_>>::new(); // hpc-exempt: walked junctions.
    for &[a, b] in worn.keys() {
        neighbours.entry(a).or_default().push(b);
        neighbours.entry(b).or_default().push(a);
    }
    let contacts = noded.street_contacts(town.streets(), neighbours.keys().copied(), spatial)?;
    let mut sources = BTreeMap::new(); // hpc-exempt: road contacts within occupied frontage.
    for (key, (street, point)) in contacts {
        if has_frontage(town, point, spatial)? {
            sources.insert(key, (groups.find(street), street, point));
        }
    }
    let before = paths.len();
    paths.extend(connections(worn, &neighbours, &sources));
    Ok((paths.len() > before).then_some(StreetGroups {
        groups,
        streets: town.streets().len(),
    }))
}

fn has_frontage(town: &Town, point: Point, spatial: &dyn SpatialKernel) -> io::Result<bool> {
    let [x, y] = point;
    let depth = town.plot().1;
    let land = atlas_map::regions::point(Position::xy(x, y));
    for i in town.nearby_holdings(Bounds(x - depth, y - depth, x + depth, y + depth), spatial)? {
        let h = &town.holdings()[i];
        if h.occupation > 0.
            && h.standing()
            && !h.buildings.is_empty()
            && spatial
                .distance(&h.outline, &land)
                .map_err(io::Error::other)?
                <= depth
        {
            return Ok(true);
        }
    }
    Ok(false)
}

struct Label {
    root: JunctionId,
    departure: JunctionId,
    previous: JunctionId,
    cost: u64,
}
type Sources = BTreeMap<JunctionId, (usize, usize, Point)>; // hpc-exempt: inhabited street entries.
type Links = BTreeMap<JunctionId, Vec<JunctionId>>; // hpc-exempt: neighbouring walked junctions.

fn connections(worn: &Worn, neighbours: &Links, starts: &Sources) -> Vec<LaneCourse> {
    let mut heap = BinaryHeap::new();
    let mut labels = BTreeMap::new(); // hpc-exempt: sparse labels on the worn walking graph.
    for &root in starts.keys() {
        labels.insert(
            root,
            Label {
                root,
                departure: root,
                previous: root,
                cost: 0,
            },
        );
        heap.push(Reverse((0, root)));
    }
    while let Some(Reverse((cost, node))) = heap.pop() {
        if labels[&node].cost != cost {
            continue;
        }
        let root = labels[&node].root;
        for &other in &neighbours[&node] {
            let next = cost + (1000. * distance(node.point(), other.point())).round() as u64;
            if labels.get(&other).is_none_or(|l| next < l.cost) {
                let departure = if node == root {
                    other
                } else {
                    labels[&node].departure
                };
                labels.insert(
                    other,
                    Label {
                        root,
                        departure,
                        previous: node,
                        cost: next,
                    },
                );
                heap.push(Reverse((next, other)));
            }
        }
    }
    let mut best = BTreeMap::<_, (f64, JunctionId, JunctionId)>::new(); // hpc-exempt: meeting of two physical street components.
    for &[a, b] in worn.keys() {
        let (Some(u), Some(v)) = (labels.get(&a), labels.get(&b)) else {
            continue;
        };
        let (s, t) = (starts[&u.root].0, starts[&v.root].0);
        if s == t {
            continue;
        }
        let total = (u.cost + v.cost) as f64 * 0.001 + distance(a.point(), b.point());
        // A different worn departure can fit when a shorter route from the
        // same street is pinched between buildings.
        let left = (u.root, u.departure);
        let right = (v.root, v.departure);
        let entry = best
            .entry([left.min(right), left.max(right)])
            .or_insert((total, a, b));
        if total < entry.0 {
            *entry = (total, a, b);
        }
    }
    // Two streets whose contacts fall within one junction already meet there, and
    // no lane lies between them to surface.
    best.into_values()
        .map(|(_, a, b)| joined_course(a, b, &labels, starts, worn))
        .filter(|course| {
            crate::town::geometry::line_length(&course.points)
                > crate::town::settings::JUNCTION_TOLERANCE
        })
        .collect()
}

fn joined_course(
    a: JunctionId,
    b: JunctionId,
    labels: &BTreeMap<JunctionId, Label>, // hpc-exempt: shortest paths to each visited junction.
    starts: &Sources,
    worn: &Worn,
) -> LaneCourse {
    let leg = |mut node| {
        let mut path = vec![node];
        while labels[&node].previous != node {
            node = labels[&node].previous;
            path.push(node);
        }
        path
    };
    let mut ids = leg(a);
    ids.reverse();
    ids.extend(leg(b));
    let (_, first, from) = starts[&ids[0]];
    let (_, last, to) = starts[ids.last().unwrap()];
    let mut class = Class::Alley;
    let mut wear = f64::INFINITY;
    for section in ids.windows(2) {
        let (a, b) = (section[0], section[1]);
        let (use_, form) = worn[&[a.min(b), a.max(b)]];
        wear = wear.min(use_);
        if form == Class::Lane {
            class = Class::Lane;
        }
    }
    let mut points: Vec<_> = ids.into_iter().map(|id| id.point()).collect();
    points[0] = from;
    *points.last_mut().unwrap() = to;
    LaneCourse {
        points,
        wear,
        class,
        junctions: vec![],
        joins: Some([first, last]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn competing_worn_passages_keep_their_contacts_and_separate_paved_networks() {
        let p = |x, y| JunctionId::at([x, y]);
        let (a, b, c, d) = (p(0., 0.), p(30., 0.), p(0., 20.), p(30., 20.));
        let mut worn = Worn::new();
        let mut neighbours = Links::new();
        for (i, j) in [(a, b), (c, p(9., 24.)), (p(9., 24.), d), (a, c)] {
            worn.insert([i.min(j), i.max(j)], (3., Class::Lane));
            neighbours.entry(i).or_default().push(j);
            neighbours.entry(j).or_default().push(i);
        }
        let sources = Sources::from([
            (a, (0, 0, a.point())),
            (b, (1, 1, b.point())),
            (c, (0, 2, c.point())),
            (d, (1, 3, d.point())),
        ]);
        let routes = connections(&worn, &neighbours, &sources);
        let contacts = routes.iter().map(|r| r.joins.unwrap()).collect::<Vec<_>>();
        assert!(contacts.contains(&[0, 1]));
        assert!(contacts.contains(&[2, 3]));
        assert_eq!(contacts.len(), 2);
    }

    #[test]
    fn streets_that_meet_within_one_junction_have_no_lane_between_them() {
        let p = |x, y| JunctionId::at([x, y]);
        let (a, b) = (p(10., 10.), p(10.001, 10.));
        let worn = Worn::from([([a.min(b), a.max(b)], (3., Class::Lane))]);
        let neighbours = Links::from([(a, vec![b]), (b, vec![a])]);
        let sources = Sources::from([(a, (0, 0, [10.0004, 10.])), (b, (1, 1, b.point()))]);
        assert!(connections(&worn, &neighbours, &sources).is_empty());
    }
}
