//! Compare new construction with travelling along the connected, surveyed avenues.
use super::{
    geometry::{pos, xy},
    grades::{ground_parts, Survey, DESIGN_GRADE, SURVEY_STEP},
    Element,
};
use crate::{
    hpc::{Direction, KeyedHeap},
    spatial::SpatialKernel,
    town::{
        access::JunctionId,
        geometry::{add, distance, left, resample, scale, sub, Point},
    },
};
use atlas_map::{
    regions::{boundary_lines, point},
    spatial::SpatialIndex,
    Bounds, Geometry, Position,
};
// hpc-exempt: the avenue graph indexes surveyed junction identities.
use std::{collections::BTreeMap, io};

/// The same per-metre travel cost used by the city passage search on built links.
pub(super) const BUILT_TRAVEL: f64 = 0.32;

pub(super) struct SharedWay {
    pub approaches: [Vec<Point>; 2],
    pub ground: Vec<Vec<Point>>,
}

#[derive(Default)]
struct Graph {
    // hpc-exempt: only junctions present on surveyed avenues have node indices.
    ids: BTreeMap<JunctionId, usize>,
    points: Vec<Point>,
    edges: Vec<Vec<(usize, bool)>>,
}

impl Graph {
    fn node(&mut self, p: Point) -> usize {
        *self.ids.entry(JunctionId::at(p)).or_insert_with(|| {
            self.points.push(p);
            self.edges.push(Vec::new());
            self.points.len() - 1
        })
    }

    fn link(&mut self, a: Point, b: Point, ground: bool) {
        let a = self.node(a);
        let b = self.node(b);
        if a != b {
            self.edges[a].push((b, ground));
            self.edges[b].push((a, ground));
        }
    }

    fn route(&self, access: &Access<'_>, ends: [Point; 2], mut budget: f64) -> Option<SharedWay> {
        let mut cost = vec![f64::INFINITY; self.points.len()];
        let mut previous = vec![None; self.points.len()];
        let mut entry_bend = vec![None; self.points.len()];
        let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
        // Price an entry on the terrain only while its straight-line lower
        // bound can beat the best known journey.
        let n = self.points.len();
        let estimate = |i: usize| BUILT_TRAVEL * distance(self.points[i], ends[1]);
        self.queue_entries(ends, budget, &mut heap);
        let mut finish = None;
        while let Some((i, [bound])) = heap.pop() {
            let i = i as usize;
            if bound >= budget {
                break;
            }
            if i >= n {
                let i = i - n;
                if let Some((entry, bend)) =
                    access.join(ends[0], self.points[i], cost[i].min(budget - estimate(i)))
                {
                    cost[i] = entry;
                    previous[i] = None;
                    entry_bend[i] = bend;
                    heap.push(i as u32, [entry + estimate(i)]);
                }
                continue;
            }
            let spent = cost[i];
            if bound > spent + estimate(i) {
                continue;
            }
            let p = self.points[i];
            if previous[i].is_some() {
                if let Some((exit, bend)) = access.join(p, ends[1], budget - spent) {
                    budget = spent + exit;
                    finish = Some((i, bend));
                }
            }
            for &(j, ground) in &self.edges[i] {
                let next = spent + BUILT_TRAVEL * distance(p, self.points[j]);
                if next < cost[j] && next < budget {
                    previous[j] = Some((i, ground));
                    cost[j] = next;
                    heap.push(j as u32, [next + estimate(j)]);
                }
            }
        }
        self.trace_shared_way(ends, previous, entry_bend, finish)
    }

    fn queue_entries(&self, ends: [Point; 2], budget: f64, heap: &mut KeyedHeap) {
        for (i, &p) in self.points.iter().enumerate() {
            let lower = distance(ends[0], p) + BUILT_TRAVEL * distance(p, ends[1]);
            if lower < budget {
                heap.push((self.points.len() + i) as u32, [lower]);
            }
        }
    }

    fn trace_shared_way(
        &self,
        ends: [[f64; 2]; 2],
        previous: Vec<Option<(usize, bool)>>,
        entry_bend: Vec<Option<[f64; 2]>>,
        finish: Option<(usize, Option<[f64; 2]>)>,
    ) -> Option<SharedWay> {
        let (mut i, exit_bend) = finish?;
        let exit = self.points[i];
        let mut parts = Vec::new();
        let mut part = vec![exit];
        while let Some((prev, ground)) = previous[i] {
            if !ground {
                parts.push(std::mem::take(&mut part));
            }
            part.push(self.points[prev]);
            i = prev;
        }
        parts.push(part);
        Some(SharedWay {
            approaches: [
                std::iter::once(ends[0])
                    .chain(entry_bend[i])
                    .chain([self.points[i]])
                    .collect(),
                std::iter::once(exit)
                    .chain(exit_bend)
                    .chain([ends[1]])
                    .collect(),
            ],
            ground: parts,
        })
    }
}

struct Access<'a> {
    terrain: &'a Survey<'a>,
    earthwork: &'a dyn Fn(Point, Point) -> f64,
}

impl Access<'_> {
    fn join(&self, a: Point, b: Point, mut remaining: f64) -> Option<(f64, Option<Point>)> {
        let run = distance(a, b);
        if run >= remaining {
            return None;
        }
        let direct = self.leg(a, b, remaining);
        let mut best = direct.map(|cost| (cost, None));
        remaining = direct.unwrap_or(remaining);
        // An oblique entry can stay on grade where a perpendicular tie climbs the bank.
        // Use the same lateral bearings as the city alignment search.
        let offset = scale(left(sub(b, a)), super::journeys::LATERAL_FRACTION);
        let middle = scale(add(a, b), 0.5);
        let longest = 2. * distance(a, add(middle, offset));
        let shortest_bend = 2. * distance(a, add(middle, scale(offset, 0.5)));
        if shortest_bend >= remaining {
            return best;
        }
        if ((self.terrain.elevation)(a) - (self.terrain.elevation)(b)).abs()
            > longest * DESIGN_GRADE * 1.25
        {
            return best;
        }
        for fraction in [-0.5, 0.5, -1., 1.] {
            let via = add(middle, scale(offset, fraction));
            if let Some(first) = self.leg(a, via, remaining - distance(via, b)) {
                if let Some(last) = self.leg(via, b, remaining - first) {
                    remaining = first + last;
                    best = Some((remaining, Some(via)));
                }
            }
        }
        best
    }

    fn leg(&self, a: Point, b: Point, remaining: f64) -> Option<f64> {
        let s = self.terrain;
        let run = distance(a, b);
        if run >= remaining {
            return None;
        }
        if run < 0.001 {
            return Some(0.);
        }
        let max_grade = DESIGN_GRADE * 1.25;
        if ((s.elevation)(a) - (s.elevation)(b)).abs() > run * max_grade {
            return None;
        }
        if !(s.open)(a) {
            return None;
        }
        let pieces = (run / 12.).ceil() as usize;
        let length = run / pieces as f64;
        let delta = sub(b, a);
        let mut z = (s.elevation)(a);
        let mut cost = 0.;
        for i in 1..=pieces {
            let p = add(a, scale(delta, i as f64 / pieces as f64));
            if !(s.open)(p) {
                return None;
            }
            let next = (s.elevation)(p);
            let grade = (next - z).abs() / length;
            if grade > max_grade {
                return None;
            }
            cost += length * (1. + 12. * (grade / DESIGN_GRADE - 1.).max(0.).powi(2));
            z = next;
        }
        cost = cost.max((self.earthwork)(a, b));
        (cost < remaining).then_some(cost)
    }
}

pub(super) struct Avenues<'a> {
    ground: Vec<Geometry>,
    widths: Vec<Vec<f64>>,
    half_width: f64,
    index: Box<dyn SpatialIndex + 'a>,
    decks: Vec<[Point; 2]>,
}

impl<'a> Avenues<'a> {
    pub fn new(spatial: &'a dyn SpatialKernel, roads: &[Element]) -> io::Result<Self> {
        let mut ground = Vec::new();
        let mut widths = Vec::new();
        let mut half_width = 0.0_f64;
        let mut decks = Vec::new();
        for road in roads {
            let parts = ground_parts(road);
            let ends = |part: &Geometry| match part {
                Geometry::LineString { coordinates } => {
                    Some((*coordinates.first()?, *coordinates.last()?))
                }
                Geometry::Point { coordinates } => Some((*coordinates, *coordinates)),
                _ => None,
            };
            for pair in parts.windows(2) {
                if let (Some((_, a)), Some((b, _))) = (ends(&pair[0]), ends(&pair[1])) {
                    decks.push([xy(a), xy(b)]);
                }
            }
            let road_widths = road.attributes.get("widths").and_then(|w| w.as_array());
            let mut start = 0;
            for part in parts {
                let count = match &part {
                    Geometry::LineString { coordinates } => coordinates.len(),
                    Geometry::Point { .. } => 1,
                    _ => 0,
                };
                let stations: Vec<f64> = road_widths
                    .and_then(|w| w.get(start..start + count))
                    .and_then(|w| w.iter().map(|v| v.as_f64().filter(|n| *n > 0.)).collect())
                    .unwrap_or_default();
                for w in &stations {
                    half_width = half_width.max(w / 2.);
                }
                widths.push(stations);
                ground.push(part);
                start += count;
            }
        }
        let index = spatial.index(&ground).map_err(io::Error::other)?;
        Ok(Self {
            ground,
            widths,
            half_width,
            index,
            decks,
        })
    }

    /// A place on a carriageway is served at its projected station. Its civic
    /// position stays fixed, even where the centreline lies across the pavement.
    pub fn attachment(&self, spatial: &dyn SpatialKernel, p: Position) -> io::Result<Position> {
        let [x, y] = xy(p);
        let r = self.half_width;
        let bounds = Bounds(x - r, y - r, x + r, y + r);
        let mut nearest = f64::INFINITY;
        let mut station = p;
        for (i, d) in self.index.distances(bounds, p).map_err(io::Error::other)? {
            let widths = &self.widths[i];
            if d >= nearest || !widths.iter().any(|w| d <= w / 2.) {
                continue;
            }
            let shape = &self.ground[i];
            if let Geometry::LineString { coordinates } = shape {
                if widths.iter().any(|w| d > w / 2.) {
                    let outline = atlas_map::hexes::width_outline(coordinates, widths, spatial)
                        .map_err(io::Error::other)?;
                    let Some(outline) = outline else { continue };
                    if !spatial
                        .covers_points(&outline, &[p])
                        .map_err(io::Error::other)?[0]
                    {
                        continue;
                    }
                }
            }
            station = spatial
                .nearest_points(&point(p), shape)
                .map_err(io::Error::other)?[1];
            nearest = d;
        }
        Ok(station)
    }

    // owner-direction(2026-11-25): major thoroughfares share a corridor when later journeys would build parallel avenues a few metres apart.
    pub fn share(
        &self,
        spatial: &dyn SpatialKernel,
        survey: &Survey<'_>,
        ends: [Point; 2],
        earthwork: &dyn Fn(Point, Point) -> f64,
    ) -> io::Result<Option<SharedWay>> {
        let [a, b] = ends;
        let budget = distance(a, b)
            .max(((survey.elevation)(b) - (survey.elevation)(a)).abs() / DESIGN_GRADE);
        if self.ground.is_empty() || budget < 0.001 {
            return Ok(None);
        }
        let reach = budget / BUILT_TRAVEL;
        let bounds = atlas_map::Bounds(a[0] - reach, a[1] - reach, a[0] + reach, a[1] + reach);
        let nearby = self.index.query(bounds).map_err(io::Error::other)?;
        let mut graph = Graph::default();
        self.node_approaches(spatial, ends, nearby, &mut graph)?;
        for &[p, q] in &self.decks {
            if graph.ids.contains_key(&JunctionId::at(p))
                && graph.ids.contains_key(&JunctionId::at(q))
            {
                graph.link(p, q, false);
            }
        }
        Ok(graph.route(
            &Access {
                terrain: survey,
                earthwork,
            },
            ends,
            budget,
        ))
    }

    fn node_approaches(
        &self,
        spatial: &dyn SpatialKernel,
        ends: [[f64; 2]; 2],
        nearby: Vec<usize>,
        graph: &mut Graph,
    ) -> Result<(), io::Error> {
        let mut lines = Vec::new();
        for i in nearby {
            match &self.ground[i] {
                Geometry::LineString { coordinates } => lines.push(coordinates.clone()),
                Geometry::Point { coordinates } => {
                    graph.node(xy(*coordinates));
                }
                _ => {}
            }
        }
        if !lines.is_empty() {
            let noded = spatial
                .node_lines(&Geometry::MultiLineString { coordinates: lines })
                .map_err(io::Error::other)?;
            for path in noded.as_ref().into_iter().flat_map(boundary_lines) {
                let geo = Geometry::LineString {
                    coordinates: path.clone(),
                };
                let mut stations = Vec::<(f64, Position)>::new();
                let mut along = 0.;
                // An oblique approach can meet the grade between existing vertices
                // even when the perpendicular approach would climb too steeply.
                let sites = resample(
                    &path.iter().copied().map(xy).collect::<Vec<_>>(),
                    SURVEY_STEP,
                );
                for (i, &p) in sites.iter().enumerate() {
                    if i > 0 {
                        along += distance(sites[i - 1], p);
                    }
                    stations.push((along, pos(p)));
                }
                for f in spatial
                    .line_fractions(&geo, &ends.map(pos))
                    .map_err(io::Error::other)?
                {
                    stations.push((
                        along * f,
                        spatial.line_at(&geo, f).map_err(io::Error::other)?,
                    ));
                }
                // hpc-exempt: link irregular survey stations and attachments in distance order along this avenue.
                stations.sort_by(|a, b| a.0.total_cmp(&b.0));
                for pair in stations.windows(2) {
                    graph.link(xy(pair[0].1), xy(pair[1].1), true);
                }
            }
        }
        Ok(())
    }
}
