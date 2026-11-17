//! Trails people wear from the places they visit to the ways they already use. Each follows
//! the cheapest walk over the map's triangles, where steep ground, dense cover and water cost
//! more; a trail already laid costs less to walk, so later trails bend to meet it and join it
//! rather than run beside it to the way.
use super::{distance, settings::WORN_SHARE};
use std::{cmp::Ordering, collections::BinaryHeap};

/// The walkable triangles: position, neighbours and walking cost per metre through each.
pub struct Graph<'a> {
    pub positions: &'a [[f64; 2]],
    pub neighbours: &'a [[Option<usize>; 3]],
    pub cost: &'a [f64],
}
#[derive(Clone, Debug, PartialEq)]
pub struct Trail {
    /// The source's index in the order given.
    pub source: usize,
    /// Triangles from the source to where the trail meets a way or an earlier trail.
    pub cells: Vec<usize>,
    /// The earlier trail it joins, when it ends on one.
    pub joins: Option<usize>,
}
#[derive(PartialEq)]
struct Open(f64, usize);
impl Eq for Open {}
impl Ord for Open {
    fn cmp(&self, other: &Self) -> Ordering {
        other.0.total_cmp(&self.0).then(other.1.cmp(&self.1))
    }
}
impl PartialOrd for Open {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
fn walking(graph: &Graph<'_>, worn: &[bool], cell: usize) -> f64 {
    graph.cost[cell] * if worn[cell] { WORN_SHARE } else { 1.0 }
}
/// The cheapest walk from `from` to the nearest other triangle marked in `ends`.
pub fn path(graph: &Graph<'_>, from: usize, ends: &[bool], worn: &[bool]) -> Option<Vec<usize>> {
    let n = graph.positions.len();
    let mut best = vec![f64::INFINITY; n];
    let mut previous = vec![usize::MAX; n];
    let mut open = BinaryHeap::new();
    best[from] = 0.0;
    open.push(Open(0.0, from));
    while let Some(Open(spent, cell)) = open.pop() {
        if spent > best[cell] {
            continue;
        }
        if ends[cell] && cell != from {
            let mut cells = vec![cell];
            while let Some(&last) = cells.last().filter(|&&c| c != from) {
                cells.push(previous[last]);
            }
            cells.reverse();
            return Some(cells);
        }
        for next in graph.neighbours[cell].into_iter().flatten() {
            let step = distance(graph.positions[cell], graph.positions[next])
                * (walking(graph, worn, cell) + walking(graph, worn, next))
                / 2.0;
            if step.is_finite() && spent + step < best[next] {
                best[next] = spent + step;
                previous[next] = cell;
                open.push(Open(spent + step, next));
            }
        }
    }
    None
}
/// How many trails walk each triangle: a trail's own triangles once, and every triangle of the
/// trails it joins from the joining point on, down to the way.
fn walk_on(trails: &[Trail], uses: &mut [u32], mut trail: usize, mut from: usize) {
    loop {
        let cells = &trails[trail].cells;
        let start = cells.iter().position(|&c| c == from).unwrap_or(0);
        for &cell in &cells[start..] {
            uses[cell] += 1;
        }
        match trails[trail].joins {
            Some(next) => {
                from = *cells.last().expect("a laid trail has triangles");
                trail = next;
            }
            None => return,
        }
    }
}
/// Lays a trail from each source in turn to the nearest end other than itself (a settlement
/// without a way walks to the next), wearing each in so later trails join it. Returns the
/// trails and how many trails walk each triangle.
pub fn lay(graph: &Graph<'_>, sources: &[usize], ends: &[bool]) -> (Vec<Trail>, Vec<u32>) {
    let n = graph.positions.len();
    let mut worn = vec![false; n];
    let mut owner: Vec<Option<usize>> = vec![None; n];
    let mut uses = vec![0u32; n];
    let mut trails: Vec<Trail> = Vec::new();
    for (source, &from) in sources.iter().enumerate() {
        if owner[from].is_some() {
            continue;
        }
        let Some(mut cells) = path(graph, from, ends, &worn) else {
            continue;
        };
        let join = cells.iter().position(|&c| owner[c].is_some());
        let joins = join.map(|at| {
            cells.truncate(at + 1);
            owner[cells[at]].expect("a joined triangle has its trail")
        });
        for &cell in &cells[..cells.len() - usize::from(joins.is_some())] {
            worn[cell] = true;
            owner[cell] = Some(trails.len());
            uses[cell] += 1;
        }
        if let Some(earlier) = joins {
            walk_on(
                &trails,
                &mut uses,
                earlier,
                *cells.last().expect("a path has triangles"),
            );
        }
        trails.push(Trail {
            source,
            cells,
            joins,
        });
    }
    (trails, uses)
}
/// Rounds a line between triangle centres by cutting its corners, keeping both ends.
pub fn smooth(points: &[[f64; 2]], passes: usize) -> Vec<[f64; 2]> {
    let mut line = points.to_vec();
    for _ in 0..passes {
        if line.len() < 3 {
            return line;
        }
        let mut next = vec![line[0]];
        for pair in line.windows(2) {
            let [a, b] = [pair[0], pair[1]];
            next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
            next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
        }
        next.push(*line.last().expect("a line has points"));
        next.remove(1);
        next.remove(next.len() - 2);
        line = next;
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;
    type Lattice = (Vec<[f64; 2]>, Vec<[Option<usize>; 3]>);
    /// A lattice of `columns` by `rows` triangles joined like the map's: left, right, and up or
    /// down by turns.
    fn lattice(columns: usize, rows: usize) -> Lattice {
        let at = |c: usize, r: usize| r * columns + c;
        let mut positions = Vec::new();
        let mut neighbours = Vec::new();
        for r in 0..rows {
            for c in 0..columns {
                positions.push([c as f64, r as f64]);
                let vertical = if (c + r) % 2 == 0 {
                    (r + 1 < rows).then(|| at(c, r + 1))
                } else {
                    r.checked_sub(1).map(|r| at(c, r))
                };
                neighbours.push([
                    c.checked_sub(1).map(|c| at(c, r)),
                    (c + 1 < columns).then(|| at(c + 1, r)),
                    vertical,
                ]);
            }
        }
        (positions, neighbours)
    }
    #[test]
    fn a_trail_takes_the_cheap_way_round_deep_water() {
        let (positions, neighbours) = lattice(20, 10);
        let mut cost = vec![1.0; positions.len()];
        for r in 0..10 {
            cost[r * 20 + 10] = if r == 8 { 3.0 } else { 40.0 };
        }
        let mut ends = vec![false; positions.len()];
        ends[5 * 20 + 19] = true;
        let graph = Graph {
            positions: &positions,
            neighbours: &neighbours,
            cost: &cost,
        };
        let found = path(&graph, 5 * 20, &ends, &vec![false; positions.len()]).unwrap();
        assert_eq!(found.first(), Some(&100));
        assert_eq!(found.last(), Some(&119));
        assert!(found.contains(&(8 * 20 + 10)));
    }
    #[test]
    fn a_later_trail_joins_an_earlier_one() {
        let (positions, neighbours) = lattice(30, 12);
        let cost = vec![1.0; positions.len()];
        let mut ends = vec![false; positions.len()];
        for r in 0..12 {
            ends[r * 30 + 29] = true;
        }
        let graph = Graph {
            positions: &positions,
            neighbours: &neighbours,
            cost: &cost,
        };
        let (trails, uses) = lay(&graph, &[4 * 30, 7 * 30], &ends);
        assert_eq!(trails.len(), 2);
        assert_eq!(trails[0].joins, None);
        assert!(ends[*trails[0].cells.last().unwrap()]);
        assert_eq!(trails[1].joins, Some(0));
        // The second trail is short: it meets the first rather than walking to the way.
        assert!(trails[1].cells.len() < trails[0].cells.len());
        let last = *trails[0].cells.last().unwrap();
        assert_eq!(uses[last], 2);
        assert_eq!(uses[trails[0].cells[0]], 1);
    }
    #[test]
    fn smoothing_keeps_the_ends() {
        let line = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [2.0, 1.0]];
        let round = smooth(&line, 2);
        assert_eq!(round.first(), Some(&[0.0, 0.0]));
        assert_eq!(round.last(), Some(&[2.0, 1.0]));
        assert!(round.len() > line.len());
    }
}
