//! Walking to an independent entrance uses open land. Neighbouring entrances share
//! visible paths; when those paths meet an obstacle, all queries share the same
//! decomposition of the traversable ground into adjoining rectangles.
use super::{pos, BoundNetwork, Course, Entrance, JunctionId, Point};
use crate::{
    spatial::SpatialKernel,
    town::{
        geometry::{distance, sub, unit},
        ground::{Ground, OUTSIDE, PLOT, STEEP, WALL, WATER},
    },
};
use std::{collections::BTreeMap, io};

pub(crate) const EFFORT: f64 = 1.6;
/// Walking through worked rows costs additional effort per metre. The unploughed
/// balk beside them carries ordinary foot traffic, including access into a field.
const THROUGH_CROPS: f64 = 2.4;

pub(crate) fn cost(ground: &Ground, a: Point, b: Point, effort: f64) -> f64 {
    let span = distance(a, b);
    if ground.cultivation.index.is_empty() || span == 0. {
        return span * effort;
    }
    let steps = (span / ground.cell).ceil() as usize;
    let cropped = (0..steps)
        .filter(|&i| {
            let t = (i as f64 + 0.5) / steps as f64;
            ground.ploughed([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
        })
        .count();
    span * (effort + THROUGH_CROPS * cropped as f64 / steps as f64)
}
fn open(owner: u32) -> bool {
    !matches!(owner, WATER | WALL | OUTSIDE | STEEP | PLOT)
}
pub(crate) fn clear(ground: &Ground, a: Point, b: Point) -> bool {
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
            graph.connect(vertex, attached, walk - entrance.walk, Course::Walk);
        }
        doors.insert(JunctionId::at(entrance.point), (entrance.point, vertex));
    }
    if doors.len() < 2 {
        return Ok(());
    }
    let entrances: Vec<_> = doors.values().copied().collect();
    field_margins(ground, &mut doors, graph, spatial)?;
    let doors: Vec<_> = doors.into_values().collect();
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
            graph.connect(start, end, cost(ground, p, q, EFFORT), Course::Walk);
        } else {
            obstructed = true;
        }
    }
    if obstructed {
        detours(ground, &entrances, graph);
    }
    Ok(())
}

/// Add the surveyed balks that meet the travel area to the same graph as doors,
/// streets and worn paths. Only a journey that actually uses a balk leaves a track.
fn field_margins(
    ground: &Ground,
    doors: &mut BTreeMap<JunctionId, (Point, usize)>,
    graph: &mut BoundNetwork,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    if ground.cultivation.index.is_empty() {
        return Ok(());
    }
    let area = atlas_map::Geometry::MultiPoint {
        coordinates: doors.values().map(|(p, _)| pos(*p)).collect(),
    };
    let bounds = spatial.bounds(&area).map_err(io::Error::other)?;
    for id in ground.cultivation.index.query(bounds) {
        for pair in ground.cultivation.rims[id].windows(2) {
            let (a, b) = (pair[0], pair[1]);
            if !clear(ground, a, b) {
                continue;
            }
            let (start, end) = (graph.vertex(a), graph.vertex(b));
            doors.entry(JunctionId::at(a)).or_insert((a, start));
            doors.entry(JunctionId::at(b)).or_insert((b, end));
            graph.connect(start, end, distance(a, b) * EFFORT, Course::Walk);
        }
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
    for &(a, b, via) in &mesh.crossings {
        let portal = graph.vertex(via);
        graph.connect(
            vertices[a],
            portal,
            cost(ground, mesh.centres[a], via, EFFORT),
            Course::Walk,
        );
        graph.connect(
            portal,
            vertices[b],
            cost(ground, via, mesh.centres[b], EFFORT),
            Course::Walk,
        );
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
                cost(ground, mesh.centres[span.region], point, EFFORT),
                Course::Walk,
            );
        }
    }
}
pub(crate) struct Mesh {
    rows: Vec<Vec<Span>>,
    centres: Vec<Point>,
    crossings: Vec<(usize, usize, Point)>,
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
        Self {
            rows,
            centres,
            crossings,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::{
        access::Access,
        catalogue::AccessUse,
        network::{Class, Street},
        story::Size,
    };

    #[test]
    fn a_through_walk_follows_the_slanting_balk_while_the_crop_remains_reachable() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut ground = Ground::new([-35., -40., 140., 70.], 1.);
        let corners = [[20., 6.], [90., 18.], [85., 43.], [15., 31.], [20., 6.]];
        let field = atlas_map::Geometry::Polygon {
            coordinates: vec![corners.iter().copied().map(pos).collect()],
        };
        ground.mark_ploughed(&[field], &spatial).unwrap();
        let (home, village, crop) = ([-5., 16.], [115., 32.], [54., 23.]);
        let high_street = Street::new(vec![[115., -20.], [115., 60.]], Class::Main, Size::Village);
        let access = Access::new(&[high_street], &spatial)
            .unwrap()
            .on_ground(&ground);
        let network = access
            .bind(
                &[home, village, crop].map(Entrance::independent),
                AccessUse::Foot,
                &spatial,
            )
            .unwrap();
        let routes = network.routes(0);
        let mut via_balk = false;
        routes.course(1, |_, a, b| {
            via_balk |= corners
                .windows(2)
                .any(|edge| (a == edge[0] && b == edge[1]) || (b == edge[0] && a == edge[1]));
        });
        assert!(
            via_balk,
            "the through walk should take a surveyed field edge"
        );
        assert!(routes.cost(1) < cost(&ground, home, village, EFFORT));
        assert!(routes.cost(2).is_finite(), "farmers can enter their field");
    }
}
