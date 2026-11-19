use crate::town::{
    access::{walking, Approach, Footpath, JunctionId},
    fabric::{walks::path_key, HoldingId, Town},
    geometry::{distance, Point},
    ground::Ground,
    network::Class,
};
// hpc-exempt: town walks group by geometric junction pairs rather than mesh cells.
use std::collections::{BTreeMap, BTreeSet};

struct Use {
    old: f64,
    load: f64,
    first: Option<HoldingId>,
    shared: bool,
    operating: bool,
}
pub(super) struct Walks {
    // hpc-exempt: actual traffic is grouped by the exact geometric segment it traversed.
    edges: BTreeMap<[JunctionId; 2], Use>,
    pub approaches: Vec<Option<Approach>>,
    // hpc-exempt: realized street entries and founding destinations anchor surface work.
    junctions: BTreeSet<JunctionId>,
}

pub(super) struct LaneCourse {
    pub points: Vec<Point>,
    pub wear: f64,
    pub class: Class,
}
impl Walks {
    pub fn new(town: &Town, ground: &Ground) -> Self {
        let edges = town
            .footpaths()
            .iter()
            .filter(|p| walking::clear(ground, p.points[0], p.points[1]))
            .map(|p| {
                (
                    path_key(p.points[0], p.points[1]),
                    Use {
                        old: p.wear,
                        load: 0.,
                        first: None,
                        shared: false,
                        operating: false,
                    },
                )
            })
            .collect();
        Self {
            edges,
            approaches: town
                .holdings()
                .iter()
                .map(|h| town.approach(h.id).cloned())
                .collect(),
            junctions: BTreeSet::new(),
        }
    }
    pub fn visit(&mut self, h: HoldingId, load: f64, a: Point, b: Point, operating: bool) {
        let key = path_key(a, b);
        if key[0] == key[1] {
            return;
        }
        let edge = self.edges.entry(key).or_insert(Use {
            old: 0.,
            load: 0.,
            first: None,
            shared: false,
            operating: false,
        });
        edge.shared |= edge.first.is_some_and(|other| other != h);
        edge.first = Some(h);
        edge.load += load;
        edge.operating |= operating;
    }
    pub fn junction(&mut self, point: Point) {
        self.junctions.insert(JunctionId::at(point));
    }
    pub fn finish(self, town: &mut Town, exposure: f64) -> (Vec<LaneCourse>, usize) {
        let fade = (-0.35 * exposure).exp();
        let mut retained = Vec::new();
        // hpc-exempt: wear belongs to a segment of a realized pedestrian course.
        let mut worn = BTreeMap::new();
        for (key @ [a, b], use_) in self.edges {
            let wear = use_.old * fade + use_.load * exposure;
            if wear < 0.05 && use_.load == 0. {
                continue;
            }
            let path = Footpath {
                points: [a.point(), b.point()],
                wear,
            };
            if use_.old > 0.
                && use_.load > 0.
                && wear > 1.
                && (use_.shared || town.streets().is_empty())
            {
                worn.insert(
                    key,
                    (
                        wear,
                        if use_.operating {
                            Class::Lane
                        } else {
                            Class::Alley
                        },
                    ),
                );
            }
            retained.push(path);
        }
        town.record_walks(retained, self.approaches);
        (surface_courses(&worn, &self.junctions), worn.len())
    }
}

/// Partition shared traffic into physical corridors. A fork between occupied
/// places can develop a public way before it connects to a named street.
fn surface_courses(
    worn: &BTreeMap<[JunctionId; 2], (f64, Class)>, // hpc-exempt: physical path stretches.
    junctions: &BTreeSet<JunctionId>,               // hpc-exempt: observed entry points.
) -> Vec<LaneCourse> {
    // hpc-exempt: adjacency of the retained worn path network.
    let mut neighbours = BTreeMap::<_, Vec<_>>::new();
    for &[a, b] in worn.keys() {
        neighbours.entry(a).or_default().push(b);
        neighbours.entry(b).or_default().push(a);
    }
    let mut claimed = BTreeSet::new(); // hpc-exempt: each physical segment enters at most one proposal.
    let mut courses = Vec::new();
    let key = |a: JunctionId, b: JunctionId| [a.min(b), a.max(b)];
    let boundary = |node: &JunctionId| {
        if junctions.contains(node) {
            return true;
        }
        let [a, b] = neighbours[node].as_slice() else {
            return true;
        };
        worn[&key(*node, *a)].1 != worn[&key(*node, *b)].1
    };
    // Visit ends and forks before interiors so a street stays one course
    // through a bend. The last pass also reaches closed circuits.
    let starts = junctions
        .iter()
        .chain(neighbours.keys().filter(|n| boundary(n)))
        .chain(neighbours.keys());
    for &start in starts {
        for &first in neighbours.get(&start).into_iter().flatten() {
            if claimed.contains(&key(start, first)) {
                continue;
            }
            let class = worn[&key(start, first)].1;
            let (mut previous, mut next) = (start, first);
            let mut points = vec![start.point()];
            let (mut length, mut use_metres) = (0., 0.);
            loop {
                let edge = key(previous, next);
                let (wear, segment_class) = worn[&edge];
                if segment_class != class || !claimed.insert(edge) {
                    break;
                }
                let metres = distance(previous.point(), next.point());
                length += metres;
                use_metres += wear * metres;
                points.push(next.point());
                if boundary(&next) {
                    break;
                }
                let [a, b] = neighbours[&next].as_slice() else {
                    break;
                };
                (previous, next) = (next, if *a == previous { *b } else { *a });
            }
            if length > 0. {
                courses.push(LaneCourse {
                    points,
                    wear: use_metres / length,
                    class,
                });
            }
        }
    }
    courses
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surface_only_contiguous_worn_edges_once_even_with_two_street_ends() {
        let door = [10., 12.];
        let fork = [10., 5.];
        let bend = [8., 4.];
        let street = [0., 0.];
        let mut worn = BTreeMap::from([(path_key(bend, fork), (4., Class::Lane))]); // hpc-exempt: explicit path geometry.
        let junctions = BTreeSet::from([JunctionId::at(street), JunctionId::at(door)]); // hpc-exempt: supplied street entries.
        let isolated = surface_courses(&worn, &junctions);
        assert_eq!(isolated.len(), 1);
        assert_eq!(isolated[0].points, [bend, fork]);
        worn.insert(path_key(street, bend), (2., Class::Lane));
        assert_eq!(
            surface_courses(&worn, &junctions)[0].points,
            [street, bend, fork]
        );
        worn.insert(path_key(fork, door), (3., Class::Lane));
        let courses = surface_courses(&worn, &junctions);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].points, [street, bend, fork, door]);
    }
}
