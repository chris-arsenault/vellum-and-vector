use super::{mix, polygonize, Edges, Point, Sample};
use crate::spatial::SpatialKernel;
use atlas_map::Geometry;
use std::io;
fn crossing(mut a: Sample, mut b: Sample, level: f64) -> Point {
    if a[0] > b[0] || (a[0] == b[0] && a[1] > b[1]) {
        std::mem::swap(&mut a, &mut b);
    }
    mix([a[0], a[1]], [b[0], b[1]], (level - a[2]) / (b[2] - a[2]))
}
pub struct Linear {
    edges: Edges,
    level: f64,
}
impl Linear {
    pub fn new(precision: f64, level: f64) -> Self {
        Self {
            edges: Edges::new(precision),
            level,
        }
    }
    pub fn triangle(&mut self, triangle: [Sample; 3]) {
        let inside = triangle.map(|p| p[2] > self.level);
        let count = inside.iter().filter(|&&inside| inside).count();
        if count == 0 || count == 3 {
            return;
        }
        let isolated = inside
            .iter()
            .position(|&inside| inside == (count == 1))
            .unwrap();
        let a = triangle[isolated];
        let b = triangle[(isolated + 1) % 3];
        let c = triangle[(isolated + 2) % 3];
        let first = crossing(a, b, self.level);
        let last = crossing(a, c, self.level);
        if count == 1 {
            self.edges.add(first, last);
        } else {
            self.edges.add(last, first);
        }
    }
    pub fn boundary(&mut self, [a, b]: [Sample; 2]) {
        let ia = a[2] > self.level;
        let ib = b[2] > self.level;
        if !ia && !ib {
            return;
        }
        let p = if ia == ib {
            [a[0], a[1]]
        } else {
            crossing(a, b, self.level)
        };
        self.edges.add(
            if ia { [a[0], a[1]] } else { p },
            if ib { [b[0], b[1]] } else { p },
        );
    }
    pub fn finish(
        self,
        kernel: &dyn SpatialKernel,
        at: &mut dyn FnMut(Point) -> io::Result<f64>,
    ) -> io::Result<Option<Geometry>> {
        polygonize(self.edges, kernel, at, self.level)
    }
}
