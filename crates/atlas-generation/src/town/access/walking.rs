//! Walking to an independent entrance uses open land. Neighbouring entrances share
//! visible paths; when those paths meet an obstacle, all queries share the same
//! decomposition of the traversable ground into adjoining rectangles.
use super::{pos, BoundNetwork, Entrance, JunctionId, Point};
use crate::{
    spatial::SpatialKernel,
    town::{
        geometry::{distance, sub, unit},
        ground::{Ground, OUTSIDE, PLOT, STEEP, WALL, WATER},
    },
};
use std::{collections::BTreeMap, io};

pub(super) const EFFORT: f64 = 1.6;
fn open(owner: u32) -> bool {
    !matches!(owner, WATER | WALL | OUTSIDE | STEEP | PLOT)
}
pub(super) fn clear(ground: &Ground, a: Point, b: Point) -> bool {
    let direction = unit(sub(b, a));
    let permitted = |p| {
        open(ground.owner(p)) || (ground.owner(p) == STEEP && ground.passes_hillside(p, direction))
    };
    if !permitted(a) || !permitted(b) {
        return false;
    }
    let steps = (distance(a, b) / (ground.cell * 0.4)).ceil() as usize;
    (1..steps).all(|i| {
        let t = i as f64 / steps as f64;
        permitted([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    })
}

pub(super) fn connect(
    ground: &Ground,
    entries: &[Entrance],
    graph: &mut BoundNetwork,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    // hpc-exempt: deduplicate coincident geometric doorways before triangulating them.
    let mut doors = BTreeMap::new();
    for (i, entrance) in entries.iter().enumerate() {
        if !open(ground.owner(entrance.point)) {
            continue;
        }
        let vertex = graph.vertex(entrance.point);
        let Some((attached, walk)) = graph.entrances[i] else {
            graph.entrances[i] = Some((vertex, entrance.walk));
            doors.insert(JunctionId::at(entrance.point), (entrance.point, vertex));
            continue;
        };
        if attached != vertex {
            graph.connect(vertex, attached, walk - entrance.walk, None);
        }
        doors.insert(JunctionId::at(entrance.point), (entrance.point, vertex));
    }
    let doors: Vec<_> = doors.into_values().collect();
    if doors.len() < 2 {
        return Ok(());
    }
    let points = doors.iter().map(|(p, _)| pos(*p)).collect::<Vec<_>>();
    let mut edges = spatial.delaunay_edges(&points).map_err(io::Error::other)?;
    // GEOS returns no triangles on a line. Lexicographic order follows collinear doors.
    if edges.is_empty() {
        edges.extend((1..doors.len()).map(|i| [i - 1, i]));
    }
    let mut obstructed = false;
    for [a, b] in edges {
        let (p, start) = doors[a];
        let (q, end) = doors[b];
        if clear(ground, p, q) {
            graph.connect(start, end, distance(p, q) * EFFORT, None);
        } else {
            obstructed = true;
        }
    }
    if obstructed {
        detours(ground, &doors, graph);
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct Span {
    start: usize,
    end: usize,
    region: usize,
}
struct Region {
    start: usize,
    end: usize,
    first: usize,
    last: usize,
}

fn spans(ground: &Ground, row: usize) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut x = 0;
    while x < ground.columns {
        if !open(ground.owner_at(row * ground.columns + x)) {
            x += 1;
            continue;
        }
        let start = x;
        while x < ground.columns && open(ground.owner_at(row * ground.columns + x)) {
            x += 1;
        }
        spans.push(Span {
            start,
            end: x,
            region: 0,
        });
    }
    spans
}
fn detours(ground: &Ground, doors: &[(Point, usize)], graph: &mut BoundNetwork) {
    let mesh = ground
        .walks
        .get_or_init(|| std::rc::Rc::new(Mesh::build(ground)));
    let vertices: Vec<_> = mesh.centres.iter().map(|&p| graph.vertex(p)).collect();
    for &(a, b, cost) in &mesh.crossings {
        graph.connect(vertices[a], vertices[b], cost, None);
    }
    for &(point, vertex) in doors {
        let Some(cell) = ground.index(point) else {
            continue;
        };
        let row = &mesh.rows[cell / ground.columns];
        let x = cell % ground.columns;
        if let Some(span) = row
            .get(row.partition_point(|s| s.end <= x))
            .filter(|s| s.start <= x)
        {
            graph.connect(
                vertices[span.region],
                vertex,
                distance(mesh.centres[span.region], point) * EFFORT,
                None,
            );
        }
    }
}
pub(crate) struct Mesh {
    rows: Vec<Vec<Span>>,
    centres: Vec<Point>,
    crossings: Vec<(usize, usize, f64)>,
}
impl Mesh {
    fn build(ground: &Ground) -> Self {
        let mut regions: Vec<Region> = Vec::new();
        let mut crossings = Vec::new();
        let mut rows = Vec::new();
        for row in 0..ground.rows {
            let previous = rows.last().map(Vec::as_slice).unwrap_or(&[] as &[Span]);
            let mut current = spans(ground, row);
            let mut first = 0;
            for s in &mut current {
                while first < previous.len() && previous[first].end <= s.start {
                    first += 1;
                }
                if let Some(p) = previous
                    .get(first)
                    .filter(|p| p.start == s.start && p.end == s.end)
                {
                    s.region = p.region;
                    regions[p.region].last = row;
                } else {
                    s.region = regions.len();
                    regions.push(Region {
                        start: s.start,
                        end: s.end,
                        first: row,
                        last: row,
                    });
                    for p in previous[first..].iter().take_while(|p| p.start < s.end) {
                        let x = (p.start.max(s.start) + p.end.min(s.end)) as f64 / 2.;
                        crossings.push((
                            p.region,
                            s.region,
                            [
                                ground.origin[0] + x * ground.cell,
                                ground.origin[1] + row as f64 * ground.cell,
                            ],
                        ));
                    }
                }
            }
            rows.push(current);
        }
        let centres: Vec<_> = regions
            .into_iter()
            .map(|r| {
                [
                    ground.origin[0] + (r.start + r.end) as f64 * ground.cell / 2.,
                    ground.origin[1] + (r.first + r.last + 1) as f64 * ground.cell / 2.,
                ]
            })
            .collect();
        let crossings = crossings
            .into_iter()
            .map(|(a, b, via)| {
                (
                    a,
                    b,
                    (distance(centres[a], via) + distance(via, centres[b])) * EFFORT,
                )
            })
            .collect();
        Self {
            rows,
            centres,
            crossings,
        }
    }
}
