use crate::town::{
    access::{walking, Approach, Footpath, JunctionId},
    fabric::{walks::path_key, HoldingId, Town},
    geometry::{distance, Point},
    ground::Ground,
    network::Class,
};
// hpc-exempt: town walks group by geometric junction pairs rather than mesh cells.
use std::collections::{BTreeMap, BTreeSet};
pub(super) mod passages;
// hpc-exempt: demand shared along exact walked junction pairs.
pub(super) type Worn = BTreeMap<[JunctionId; 2], (f64, Class)>;

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
    pub(super) junctions: Vec<usize>,
    pub wear: f64,
    pub class: Class,
    pub joins: Option<[usize; 2]>,
}
impl LaneCourse {
    /// A long public walk can be improved one junction at a time when the
    /// whole route crosses a building, a square, or unaffordable land.
    pub fn junction_sections<'a>(&self, aligned: &'a [Point]) -> Vec<&'a [Point]> {
        let mut sections = Vec::new();
        if self.junctions.is_empty() {
            return sections;
        }
        let mut start = 0;
        for index in &self.junctions {
            let Some(offset) = aligned[start + 1..]
                .iter()
                .position(|p| *p == self.points[*index])
            else {
                continue;
            };
            let end = start + 1 + offset;
            sections.push(&aligned[start..=end]);
            start = end;
        }
        if start > 0 && start + 1 < aligned.len() {
            sections.push(&aligned[start..]);
        }
        sections
    }

    /// Simplify the turns of the walking mesh within a carriageway. Every
    /// branch still meets the same physical point, and a shortcut across
    /// occupied or impassable ground keeps its original path.
    pub fn alignment(
        &self,
        spatial: &dyn crate::spatial::SpatialKernel,
        ground: &Ground,
        tolerance: f64,
    ) -> std::io::Result<Vec<Point>> {
        let mut result = vec![self.points[0]];
        let mut start = 0;
        for end in self
            .junctions
            .iter()
            .copied()
            .chain(std::iter::once(self.points.len() - 1))
        {
            let section = &self.points[start..=end];
            if section.len() > 2 {
                let simplified = spatial
                    .resample_trace(&crate::town::growth::line(section), tolerance, None)
                    .map_err(std::io::Error::other)?;
                if let atlas_map::Geometry::LineString { coordinates } = simplified {
                    let points: Vec<_> = coordinates
                        .into_iter()
                        .map(|p| {
                            let [x, y, _] = p.coordinates();
                            [x, y]
                        })
                        .collect();
                    if points.len() >= 2
                        && points
                            .windows(2)
                            .all(|pair| walking::clear(ground, pair[0], pair[1]))
                    {
                        result.extend_from_slice(&points[1..points.len() - 1]);
                        result.push(section[section.len() - 1]);
                        start = end;
                        continue;
                    }
                }
            }
            result.extend_from_slice(&section[1..]);
            start = end;
        }
        Ok(result)
    }
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
            junctions: BTreeSet::new(), // hpc-exempt: observed entry points.
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
    pub fn finish(self, town: &mut Town) -> (Vec<LaneCourse>, Worn) {
        let mut retained = Vec::new();
        // hpc-exempt: wear belongs to a segment of a realized pedestrian course.
        let mut worn = BTreeMap::new();
        for (key @ [a, b], use_) in self.edges {
            let wear = use_.load;
            if wear <= 0. {
                continue;
            }
            let path = Footpath {
                points: [a.point(), b.point()],
                wear,
                beaten: use_.old > 0. || use_.shared,
            };
            if use_.old > 0. && wear > 1. && use_.shared {
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
        (surface_courses(&worn, &self.junctions), worn)
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
    // Trace from street entries and ends first. At a fork the busier arm
    // continues the lane; a smaller branch can join it without breaking it up.
    let starts = junctions
        .iter()
        .chain(neighbours.keys().filter(|n| neighbours[n].len() == 1))
        .chain(neighbours.keys());
    for &start in starts {
        for &first in neighbours.get(&start).into_iter().flatten() {
            if claimed.contains(&key(start, first)) {
                continue;
            }
            let class = worn[&key(start, first)].1;
            let (mut previous, mut next) = (start, first);
            let mut points = vec![start.point()];
            let mut forks = Vec::new();
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
                if junctions.contains(&next) || next == start {
                    break;
                }
                let onward = neighbours[&next]
                    .iter()
                    .copied()
                    .filter(|&n| {
                        let edge = key(next, n);
                        worn[&edge].1 == class && !claimed.contains(&edge)
                    })
                    .max_by(|&a, &b| {
                        let alignment = |n: JunctionId| {
                            use crate::town::geometry::{dot, sub, unit};
                            dot(
                                unit(sub(next.point(), previous.point())),
                                unit(sub(n.point(), next.point())),
                            )
                        };
                        worn[&key(next, a)]
                            .0
                            .total_cmp(&worn[&key(next, b)].0)
                            .then_with(|| alignment(a).total_cmp(&alignment(b)))
                    });
                let Some(onward) = onward else {
                    break;
                };
                if neighbours[&next].len() > 2 {
                    forks.push(points.len() - 1);
                }
                (previous, next) = (next, onward);
            }
            if length > 0. {
                courses.push(LaneCourse {
                    joins: None,
                    points,
                    junctions: forks,
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
    fn a_first_journey_can_be_routed_before_it_beats_a_visible_track() {
        let mut town = Town::new(
            crate::town::seat::Seat {
                key: atlas_map::Id::from_name("cross-country"),
                name: "Cross Country".into(),
                centre: [0., 0.],
                arms: vec![],
                story: Default::default(),
                culture: None,
            },
            None,
        );
        let ground = Ground::new([0., 0., 100., 80.], 1.);
        let start = [10., 10.];
        let end = [90., 60.];
        let mut first = Walks::new(&town, &ground);
        first.visit(HoldingId(0), 0.1, start, end, true);
        first.finish(&mut town);
        assert_eq!(town.footpaths().len(), 1);
        assert_eq!(town.beaten_paths().count(), 0);
        let mut returning = Walks::new(&town, &ground);
        returning.visit(HoldingId(0), 0.1, start, end, true);
        returning.finish(&mut town);
        assert!(town.beaten_paths().next().unwrap().width() < 0.3);
    }

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

    #[test]
    fn a_busy_course_continues_through_a_fork_with_a_lighter_side_lane() {
        let (road, fork, market, door) = ([0., 0.], [20., 0.], [60., 5.], [20., 15.]);
        // hpc-exempt: explicit walked segments.
        let worn = BTreeMap::from([
            (path_key(road, fork), (8., Class::Lane)),
            (path_key(fork, market), (7., Class::Lane)),
            (path_key(fork, door), (2., Class::Lane)),
        ]);
        let entries = BTreeSet::from([JunctionId::at(road)]); // hpc-exempt: supplied street entrance.
        let courses = surface_courses(&worn, &entries);
        assert_eq!(courses.len(), 2);
        assert_eq!(courses[0].points, [road, fork, market]);
        assert_eq!(
            courses[0].junction_sections(&courses[0].points),
            [&[road, fork][..], &[fork, market][..]]
        );
        assert!(courses[1].points.contains(&fork) && courses[1].points.contains(&door));
    }
    #[test]
    fn surfacing_straightens_walking_mesh_steps_and_retains_the_branch_junction() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let ground = Ground::new([-10., -10., 70., 30.], 1.);
        let fork = [30., 4.];
        let course = LaneCourse {
            joins: None,
            points: vec![
                [0., 0.],
                [6., 0.9],
                [12., 2.1],
                fork,
                [37., 3.8],
                [45., 2.9],
                [60., 0.],
            ],
            junctions: vec![3],
            class: Class::Lane,
            wear: 5.,
        };
        assert_eq!(
            course.alignment(&spatial, &ground, 1.5).unwrap(),
            [[0., 0.], fork, [60., 0.]]
        );
        let arterial = crate::town::network::Street::new(
            vec![[0., -10.], [0., 15.]],
            Class::Main,
            crate::town::story::Size::Town,
        );
        let network = crate::town::growth::StreetLines::new(&[arterial], &spatial).unwrap();
        let mut attached = [[0.0003, 0.], [30., 4.]];
        assert!(network.attach_walk(&mut attached).unwrap());
        assert_eq!(attached[0], [0., 0.]);
        assert!(!network.attach_walk(&mut [[30., 4.], [60., 0.]]).unwrap());
    }
}
