//! Principal journeys share existing streets. Intermediate passages and local terrain set their alignment.
use super::{
    geometry::{line, pos, xy},
    Element,
};
use crate::{
    atlas::state::State,
    field::refinement::courses::cell_at,
    hpc::{Direction, KeyedHeap},
    lattice::TriangularLattice,
    town::geometry::{distance, dot, sub, unit, Point},
};
use atlas_map::regions::point;
use std::io;

pub(super) const LATERAL_FRACTION: f64 = 0.21;

pub(super) struct Surface<'a> {
    pub mesh: &'a TriangularLattice,
    pub points: &'a [Point],
    pub effort: &'a [f64],
    pub aligned: &'a [Option<Point>],
    pub gradients: &'a [Point],
    pub seed: i32,
    pub crossing: &'a dyn Fn(usize, usize) -> f64,
}

#[derive(Clone, Copy, PartialEq)]
enum Alignment {
    Curved,
    Segmented,
    Straight,
}
impl Alignment {
    fn name(self) -> &'static str {
        match self {
            Self::Curved => "Curved",
            Self::Segmented => "Segmented",
            Self::Straight => "Straight",
        }
    }
}

impl Surface<'_> {
    fn travel(&self, a: usize, b: usize, way: &[bool]) -> f64 {
        self.directed_cost(a, b, unit(sub(self.points[b], self.points[a])), way)
    }

    fn directed_cost(&self, a: usize, b: usize, dir: Point, way: &[bool]) -> f64 {
        let axis = self.aligned[a].map_or(1., |p| 1. + (1. - dot(dir, p).abs()) * 1.6);
        let effort = |c: usize| {
            let grade = dot(self.gradients[c], dir).abs();
            // Two nearby pieces of road can lie on different legs of a climb.
            // Only the recorded links in passage() carry traffic at street cost.
            if way[c] && !(way[a] && way[b]) {
                0.32
            } else {
                0.36 + self.effort[c]
                    * (1. + 4. * grade / (0.08 + grade) + ((grade - 0.08).max(0.) / 0.08).powi(2))
            }
        };
        (effort(a) + effort(b)) * 0.5 * axis * (self.crossing)(a, b)
    }

    fn passage(&self, start: usize, end: usize, way: &[bool], links: &[Vec<usize>]) -> Vec<usize> {
        let mut costs = vec![f64::INFINITY; way.len()];
        let mut prev = vec![usize::MAX; way.len()];
        let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
        costs[start] = 0.;
        heap.push(start as u32, [0.]);
        while let Some((a, [cost])) = heap.pop() {
            let a = a as usize;
            if cost != costs[a] {
                continue;
            }
            if a == end {
                break;
            }
            for &b in &links[a] {
                let via =
                    cost + super::avenues::BUILT_TRAVEL * distance(self.points[a], self.points[b]);
                if via < costs[b] {
                    costs[b] = via;
                    prev[b] = a;
                    heap.push(b as u32, [via]);
                }
            }
            for edge in 0..3 {
                let Some(b) = self.mesh.neighbor(a, edge) else {
                    continue;
                };
                let cand = cost + self.travel(a, b, way) * self.mesh.edge_length(a, edge);
                if cand < costs[b] {
                    costs[b] = cand;
                    prev[b] = a;
                    heap.push(b as u32, [cand]);
                }
            }
        }
        if !costs[end].is_finite() {
            return Vec::new();
        }
        let mut path = vec![end];
        let mut at = end;
        while at != start {
            at = prev[at];
            path.push(at);
        }
        path.reverse();
        path
    }

    fn chord(&self, a: Point, b: Point, way: &[bool]) -> f64 {
        let length = distance(a, b);
        let heading = unit(sub(b, a));
        let n = (length / (self.mesh.spacing() * 0.4)).ceil().max(1.) as usize;
        let Some(mut last) = cell_at(self.mesh, a) else {
            return f64::INFINITY;
        };
        let mut effort = 0.;
        for i in 1..=n {
            let t = i as f64 / n as f64;
            let p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            let Some(c) = cell_at(self.mesh, p) else {
                return f64::INFINITY;
            };
            effort += self.directed_cost(last, c, heading, way);
            last = c;
        }
        effort * length / n as f64
    }

    fn alignment(&self, path: &[usize]) -> Alignment {
        let mid = self.points[path[path.len() / 2]];
        let planned =
            path.iter().filter(|&&c| self.aligned[c].is_some()).count() as f64 / path.len() as f64;
        let rough = path
            .iter()
            .map(|&c| {
                let g = self.gradients[c][0].hypot(self.gradients[c][1]);
                g / (0.08 + g)
            })
            .sum::<f64>()
            / path.len() as f64;
        let straight = 0.12 + 1.6 * planned * (1. - rough);
        let segmented = 0.46 + 0.5 * planned;
        let curved = 0.85 + 1.6 * rough;
        let roll = crate::chance::Chance::of(self.seed, 0x2c8b).unit([mid[0], mid[1]])
            * (straight + segmented + curved);
        if roll < straight {
            Alignment::Straight
        } else if roll < straight + segmented {
            Alignment::Segmented
        } else {
            Alignment::Curved
        }
    }

    fn refine(
        &self,
        path: &[usize],
        [a, b]: [Point; 2],
        way: &[bool],
        style: Alignment,
        out: &mut Vec<Point>,
    ) {
        if path.len() <= 2 {
            out.push(b);
            return;
        }
        let half = path.len() / 2;
        let on_path = self.points[path[half]];
        let direct = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
        let length = distance(a, b);
        let dir = unit(sub(b, a));
        let offset = (length * LATERAL_FRACTION).min(self.mesh.spacing() * 8.);
        let side = |t: f64| {
            [
                direct[0] - dir[1] * t * offset,
                direct[1] + dir[0] * t * offset,
            ]
        };
        // Search both sides of the chord as well as the passage on the mesh.
        // A surveyed alignment accepts modest extra earthwork to keep its bearing.
        let mut best = (f64::INFINITY, on_path);
        for p in [direct, side(-1.), side(-0.5), side(0.5), side(1.), on_path] {
            let cost = self.chord(a, p, way) + self.chord(p, b, way);
            if cost < best.0 {
                best = (cost, p);
            }
        }
        let (tolerance, detail) = match style {
            Alignment::Straight => (0.32, 8.),
            Alignment::Segmented => (0.10, 4.),
            Alignment::Curved => (0.012, 2.),
        };
        let cost = self.chord(a, b, way);
        let inspect_interior = style == Alignment::Curved && length > 5. * self.mesh.spacing();
        if cost.is_finite()
            && (length < detail * self.mesh.spacing()
                || !inspect_interior && cost <= best.0 * (1. + tolerance))
        {
            out.push(b);
            return;
        }
        if length < self.mesh.spacing() && best.0.is_finite() {
            out.push(best.1);
            out.push(b);
            return;
        }
        self.refine(&path[..=half], [a, best.1], way, style, out);
        self.refine(&path[half..], [best.1, b], way, style, out);
    }

    fn round_bends(&self, points: &[Point], way: &[bool]) -> Vec<Point> {
        let mut out = vec![points[0]];
        for t in points.windows(3) {
            let [a, b, c] = [t[0], t[1], t[2]];
            let enter = [0.3 * a[0] + 0.7 * b[0], 0.3 * a[1] + 0.7 * b[1]];
            let exit = [0.7 * b[0] + 0.3 * c[0], 0.7 * b[1] + 0.3 * c[1]];
            let middle = [
                0.25 * (enter[0] + exit[0]) + 0.5 * b[0],
                0.25 * (enter[1] + exit[1]) + 0.5 * b[1],
            ];
            let arc = self.chord(enter, middle, way) + self.chord(middle, exit, way);
            if arc.is_finite()
                && arc <= 1.06 * (self.chord(enter, b, way) + self.chord(b, exit, way))
            {
                out.extend([enter, middle, exit]);
            } else {
                out.push(b);
            }
        }
        out.push(*points.last().unwrap());
        out
    }
}

fn within_detour(graph: &[Vec<(usize, f64)>], from: usize, to: usize, limit: f64) -> bool {
    let mut costs = vec![f64::INFINITY; graph.len()];
    costs[from] = 0.;
    let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    heap.push(from as u32, [0.]);
    while let Some((i, [d])) = heap.pop() {
        let i = i as usize;
        if i == to {
            return true;
        }
        if d > costs[i] {
            continue;
        }
        for &(j, length) in &graph[i] {
            let cand = d + length;
            if cand <= limit && cand < costs[j] {
                costs[j] = cand;
                heap.push(j as u32, [cand]);
            }
        }
    }
    false
}

pub(super) fn route_connections(
    state: &State,
    s: &Surface<'_>,
    survey: &super::grades::Survey<'_>,
    plan: super::endpoints::RoadPlan,
    way: &mut [bool],
    roads: &mut Vec<Element>,
) -> io::Result<Vec<f64>> {
    let stops = &plan.stops;
    let mut traffic = vec![0.; way.len()];
    if stops.len() < 2 {
        return Ok(traffic);
    }
    // Keep the continuity of a real line even where it crosses a triangle vertex.
    let mut links = vec![Vec::new(); way.len()];
    for road in roads.iter() {
        record_road(s.mesh, road, &mut links, way);
    }
    let mut graph = vec![Vec::new(); stops.len()];
    for connection in plan.connections {
        let [a, b] = connection.endpoints;
        let weight = connection.demand;
        let direct = distance(s.points[stops[a].0], s.points[stops[b].0]);
        if connection.purpose == super::endpoints::Journey::CrossLink
            && within_detour(&graph, a, b, direct * 1.65)
        {
            continue;
        }
        let path = s.passage(stops[a].0, stops[b].0, way, &links);
        if path.len() < 2 {
            continue;
        }
        // owner-direction(2026-11-24): local numeric geography shapes the course of principal roads between their junctions.
        let style = s.alignment(&path);
        let mut used = Vec::new();
        let length = path
            .windows(2)
            .map(|p| distance(s.points[p[0]], s.points[p[1]]))
            .sum();
        graph[a].push((b, length));
        graph[b].push((a, length));
        let mut i = 0;
        while let Some([first, last]) = next_unbuilt_section(&path, way, &links, &mut i, &mut used)
        {
            let segment = &path[first..=last];
            let ends = join_existing_roads(state, s, way, roads, &path, [first, last])?;
            if distance(ends[0], ends[1]) < 1e-6 && segment.len() == 2 {
                continue;
            }
            let course = survey_alignment(state, s, way, style, segment, ends)?;
            let width = 9. + 4. * (1. + direct / 1000.).ln();
            let connection =
                survey.connections(state.spatial.as_ref(), course, width, roads, &|a, b| {
                    s.chord(a, b, way)
                })?;
            for shared in connection.shared_ground {
                used.extend(
                    crate::town::geometry::resample(&shared, s.mesh.spacing() / 4.)
                        .into_iter()
                        .filter_map(|p| cell_at(s.mesh, p)),
                );
            }
            for mut road in connection.built {
                record_road(s.mesh, &road, &mut links, way);
                used.extend(super::grades::ground_cells(s.mesh, &road));
                road.attributes
                    .insert("alignment".into(), style.name().into());
                road.attributes.insert(
                    "layoutRound".into(),
                    state.regional.as_ref().unwrap().round.into(),
                );
                road.attributes
                    .insert("from".into(), stops[a].1.clone().into());
                road.attributes
                    .insert("destination".into(), stops[b].1.clone().into());
                roads.push(road);
            }
        }
        used.sort_unstable();
        used.dedup();
        for c in used {
            traffic[c] += weight;
        }
    }
    size_corridors(s, way, roads, &traffic);
    Ok(traffic)
}

fn next_unbuilt_section(
    path: &[usize],
    way: &[bool],
    links: &[Vec<usize>],
    i: &mut usize,
    used: &mut Vec<usize>,
) -> Option<[usize; 2]> {
    while *i + 1 < path.len() {
        let first = *i;
        *i += 1;
        if links[path[first]].contains(&path[*i]) {
            used.extend_from_slice(&path[first..=*i]);
            continue;
        }
        while *i + 1 < path.len() && !way[path[*i]] {
            *i += 1;
        }
        return Some([first, *i]);
    }
    None
}

fn record_road(
    mesh: &TriangularLattice,
    road: &Element,
    links: &mut [Vec<usize>],
    way: &mut [bool],
) {
    let cells = super::grades::ground_cells(mesh, road);
    for &c in &cells {
        way[c] = true;
    }
    // Consecutive abutments link the two banks without seeding a junction beneath the deck.
    for p in cells.windows(2) {
        if p[0] != p[1] && !links[p[0]].contains(&p[1]) {
            links[p[0]].push(p[1]);
            links[p[1]].push(p[0]);
        }
    }
}

fn survey_alignment(
    state: &State,
    s: &Surface<'_>,
    way: &[bool],
    style: Alignment,
    segment: &[usize],
    ends: [[f64; 2]; 2],
) -> Result<atlas_map::Geometry, io::Error> {
    let mut points = vec![ends[0]];
    s.refine(segment, ends, way, style, &mut points);
    if style == Alignment::Curved {
        points = s.round_bends(&points, way);
    }
    let tolerance = if style == Alignment::Curved {
        0.025
    } else {
        0.10
    };
    let course = state
        .spatial
        .resample_trace(&line(&points), s.mesh.spacing() * tolerance, None)
        .map_err(io::Error::other)?;
    Ok(course)
}

fn size_corridors(s: &Surface<'_>, way: &[bool], roads: &mut [Element], traffic: &[f64]) {
    // Width and access respond to the trips a corridor carries, including the
    // passages reused by later journeys. Reassess use on each development round.
    let occupied = way.iter().filter(|&&v| v).count().max(1);
    let typical = (traffic.iter().sum::<f64>() / occupied as f64).max(0.5);
    for road in roads {
        let cells = super::grades::ground_cells(s.mesh, road);
        if cells.is_empty() {
            continue;
        }
        let load = cells.iter().map(|&c| traffic[c]).sum::<f64>() / cells.len() as f64;
        let strength = (load / (load + typical)).powi(2);
        road.attributes
            .insert("arterialStrength".into(), strength.into());
        let width = 7. + 27. * strength;
        if let Some(stations) = road
            .attributes
            .get_mut("widths")
            .and_then(|v| v.as_array_mut())
        {
            stations.fill(width.into());
        }
    }
}

fn join_existing_roads(
    state: &State,
    s: &Surface<'_>,
    way: &[bool],
    roads: &[Element],
    path: &[usize],
    [first, last]: [usize; 2],
) -> Result<[[f64; 2]; 2], io::Error> {
    let mut ends = [s.points[path[first]], s.points[path[last]]];
    let shapes: Vec<_> = roads.iter().flat_map(super::grades::ground_parts).collect();
    if !shapes.is_empty() {
        let index = state.spatial.index(&shapes).map_err(io::Error::other)?;
        for (v, c) in [(0, path[first]), (1, path[last])] {
            if !way[c] {
                continue;
            }
            let p = pos(ends[v]);
            if let Some(j) = index.nearest(p).map_err(io::Error::other)? {
                let [_, snap] = state
                    .spatial
                    .nearest_points(&point(p), &shapes[j])
                    .map_err(io::Error::other)?;
                ends[v] = xy(snap);
            }
        }
    }
    Ok(ends)
}

#[cfg(test)]
mod tests {
    use super::{within_detour, Surface};
    #[test]
    fn passage_across_a_hillside_costs_less_than_climbing_the_same_distance() {
        let mesh = crate::lattice::WorldLatticeOptions::default()
            .build(
                atlas_map::Bounds(0., 0., 4000., 3000.),
                5000.,
                0.,
                |_, _| true,
            )
            .unwrap();
        let points: Vec<_> = (0..mesh.len())
            .map(|c| super::super::fields::position(&mesh, c))
            .collect();
        let gradients = (0..mesh.len())
            .map(|c| mesh.gradient(c, &|i| Ok(0.2 * points[i][0])).unwrap())
            .collect::<Vec<_>>();
        let effort = vec![1.; mesh.len()];
        let aligned = vec![None; mesh.len()];
        let way = vec![false; mesh.len()];
        let surface = Surface {
            mesh: &mesh,
            points: &points,
            effort: &effort,
            aligned: &aligned,
            gradients: &gradients,
            seed: 1,
            crossing: &|_, _| 1.,
        };
        let start = [1500., 1500.];
        let across = surface.chord(start, [1500., 2200.], &way);
        let climb = surface.chord(start, [2200., 1500.], &way);
        assert!(across.is_finite() && climb.is_finite() && across < climb);
    }
    #[test]
    fn an_existing_indirect_journey_can_still_leave_demand_for_a_cross_connection() {
        let graph = vec![vec![(1, 300.)], vec![(0, 300.), (2, 400.)], vec![(1, 400.)]];
        assert!(within_detour(&graph, 0, 2, 710.));
        assert!(!within_detour(&graph, 0, 2, 500.));
    }
}
