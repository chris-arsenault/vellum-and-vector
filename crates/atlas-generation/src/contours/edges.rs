use super::Point;
use atlas_map::Position;
// hpc-exempt: sparse geometric vertex identities, not a cell-indexed field or spatial search.
use std::{collections::BTreeMap, io};

const LINE_POINTS: usize = 2048;
pub struct Edges {
    precision: f64,
    points: Vec<Point>,
    // hpc-exempt: exact graph vertex identity at the host's geometry precision.
    index: BTreeMap<(u64, u64), usize>,
    starts: Vec<Vec<usize>>,
    endpoints: Vec<[usize; 2]>,
    live: Vec<bool>,
}
impl Edges {
    pub fn new(precision: f64) -> Self {
        Self {
            precision,
            points: Vec::new(),
            index: Default::default(),
            starts: Vec::new(),
            endpoints: Vec::new(),
            live: Vec::new(),
        }
    }
    fn vertex(&mut self, point: Point) -> usize {
        let point = point.map(|v| (v / self.precision + 0.5).floor() * self.precision);
        let bits = |v: f64| if v == 0.0 { 0 } else { v.to_bits() };
        *self
            .index
            .entry((bits(point[0]), bits(point[1])))
            .or_insert_with(|| {
                let index = self.points.len();
                self.points.push(point);
                self.starts.push(Vec::new());
                index
            })
    }
    pub fn add(&mut self, a: Point, b: Point) {
        let a = self.vertex(a);
        let b = self.vertex(b);
        if a == b {
            return;
        }
        self.starts[a].push(self.endpoints.len());
        self.endpoints.push([a, b]);
        self.live.push(true);
    }
    fn turn(&self, incoming: usize, outgoing: usize) -> f64 {
        let [a, b] = self.endpoints[incoming].map(|at| self.points[at]);
        let [c, d] = self.endpoints[outgoing].map(|at| self.points[at]);
        let [x, y] = [b[0] - a[0], b[1] - a[1]];
        let [u, v] = [d[0] - c[0], d[1] - c[1]];
        (x * v - y * u).atan2(x * u + y * v)
    }
    fn next(&self, edge: usize) -> io::Result<usize> {
        let at = self.endpoints[edge][1];
        let mut best = None;
        let mut angle = f64::NEG_INFINITY;
        for &candidate in self.starts[at].iter().filter(|&&at| self.live[at]) {
            let turn = self.turn(edge, candidate);
            if best.is_none() || turn > angle {
                best = Some(candidate);
                angle = turn;
            }
        }
        best.ok_or_else(|| {
            io::Error::other(format!(
                "A field contour did not close at {}:{}.",
                self.points[at][0], self.points[at][1]
            ))
        })
    }
    pub fn lines(mut self) -> io::Result<Vec<Vec<Position>>> {
        let mut lines = Vec::new();
        for start in 0..self.endpoints.len() {
            if !self.live[start] {
                continue;
            }
            let mut line = vec![Position::XY(self.points[self.endpoints[start][0]])];
            let mut count = 1;
            let mut edge = start;
            loop {
                self.live[edge] = false;
                let end = self.endpoints[edge][1];
                line.push(Position::XY(self.points[end]));
                count += 1;
                if end == self.endpoints[start][0] {
                    if count >= 4 {
                        lines.push(line);
                    }
                    break;
                }
                if line.len() == LINE_POINTS {
                    lines.push(line);
                    line = vec![Position::XY(self.points[end])];
                }
                edge = self.next(edge)?;
            }
        }
        Ok(lines)
    }
}
