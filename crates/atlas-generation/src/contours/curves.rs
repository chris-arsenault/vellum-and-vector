use super::{mix, polygonize, Edges, Options, Point};
use crate::spatial::SpatialKernel;
use atlas_map::{Bounds, Geometry};
// hpc-exempt: bounded memoized geometric sample locations and shared edge crossings.
use std::{collections::BTreeMap, io};

/// Per-row memoization; the capacity bounds cached queries, never the map or its output.
struct Cache<K, V> {
    // hpc-exempt: geometric query keys and LRU stamps, not cell storage.
    items: BTreeMap<K, (V, usize)>,
    // hpc-exempt: LRU ordering of geometric queries.
    order: BTreeMap<usize, K>,
    clock: usize,
}
impl<K: Ord + Clone, V: Copy> Cache<K, V> {
    fn new() -> Self {
        Self {
            items: Default::default(),
            order: Default::default(),
            clock: 0,
        }
    }
    fn get(&mut self, key: &K) -> Option<V> {
        let (value, stamp) = self.items.get_mut(key)?;
        self.order.remove(stamp);
        self.clock += 1;
        *stamp = self.clock;
        self.order.insert(self.clock, key.clone());
        Some(*value)
    }
    fn put(&mut self, key: K, value: V) {
        const CAPACITY_BYTES: usize = 2 * 1024 * 1024;
        let entry_bytes = std::mem::size_of::<K>() * 2 + std::mem::size_of::<V>() + 80;
        if self.items.len() * entry_bytes >= CAPACITY_BYTES {
            if let Some((_, old)) = self.order.pop_first() {
                self.items.remove(&old);
            }
        }
        self.clock += 1;
        self.order.insert(self.clock, key.clone());
        self.items.insert(key, (value, self.clock));
    }
    fn clear(&mut self) {
        self.items.clear();
        self.order.clear();
        self.clock = 0;
    }
}
fn key(point: Point) -> [u64; 2] {
    point.map(|v| if v == 0.0 { 0 } else { v.to_bits() })
}
struct Queries<'a> {
    at: &'a mut dyn FnMut(Point) -> io::Result<f64>,
    level: f64,
    tolerance: f64,
    stations: Cache<[u64; 2], f64>,
    crossings: Cache<[[u64; 2]; 2], Point>,
}
impl Queries<'_> {
    fn sample(&mut self, point: Point) -> io::Result<f64> {
        if let Some(value) = self.stations.get(&key(point)) {
            return Ok(value);
        }
        let value = (self.at)(point)?;
        self.stations.put(key(point), value);
        Ok(value)
    }
    fn cross(&mut self, mut a: Point, mut b: Point) -> io::Result<Point> {
        if a[0] > b[0] || (a[0] == b[0] && a[1] > b[1]) {
            std::mem::swap(&mut a, &mut b);
        }
        let key = [key(a), key(b)];
        if let Some(point) = self.crossings.get(&key) {
            return Ok(point);
        }
        let va = self.sample(a)?;
        let vb = self.sample(b)?;
        let point = crossing(self.at, [a, b], [va, vb], self.level, self.tolerance)?;
        self.crossings.put(key, point);
        Ok(point)
    }
}
fn crossing(
    at: &mut dyn FnMut(Point) -> io::Result<f64>,
    [a, b]: [Point; 2],
    [mut va, mut vb]: [f64; 2],
    level: f64,
    tolerance: f64,
) -> io::Result<Point> {
    if va == level {
        return Ok(a);
    }
    if vb == level {
        return Ok(b);
    }
    let (mut low, mut high) = (0.0, 1.0);
    let inside = va > level;
    let length = (b[0] - a[0]).hypot(b[1] - a[1]);
    while (high - low) * length > tolerance {
        let middle = (low + high) / 2.0;
        let point = mix(a, b, middle);
        let value = at(point)?;
        if value == level {
            return Ok(point);
        }
        if (value > level) == inside {
            low = middle;
            va = value;
        } else {
            high = middle;
            vb = value;
        }
    }
    Ok(mix(a, b, low + (high - low) * ((level - va) / (vb - va))))
}
fn trace(
    vertices: [Point; 3],
    queries: &mut Queries<'_>,
    tolerance: f64,
    edges: &mut Edges,
) -> io::Result<()> {
    let mut pending = vec![vertices];
    while let Some(triangle) = pending.pop() {
        let inside = [
            queries.sample(triangle[0])? > queries.level,
            queries.sample(triangle[1])? > queries.level,
            queries.sample(triangle[2])? > queries.level,
        ];
        let count = inside.iter().filter(|&&inside| inside).count();
        if count == 0 || count == 3 {
            continue;
        }
        let isolated = inside
            .iter()
            .position(|&inside| inside == (count == 1))
            .unwrap();
        let a = triangle[isolated];
        let b = triangle[(isolated + 1) % 3];
        let c = triangle[(isolated + 2) % 3];
        let first = queries.cross(a, b)?;
        let last = queries.cross(a, c)?;
        let middle = mix(b, c, 0.5);
        if (queries.sample(middle)? > queries.level) == inside[(isolated + 1) % 3]
            && (c[0] - b[0]).hypot(c[1] - b[1]) > tolerance
        {
            let p = queries.cross(a, middle)?;
            let dx = last[0] - first[0];
            let dy = last[1] - first[1];
            let error =
                (dx * (p[1] - first[1]) - dy * (p[0] - first[0])).abs() / dx.hypot(dy).max(1e-30);
            if error > tolerance {
                pending.push([a, middle, c]);
                pending.push([a, b, middle]);
                continue;
            }
        }
        if count == 1 {
            edges.add(first, last);
        } else {
            edges.add(last, first);
        }
    }
    Ok(())
}
fn outer(
    a: Point,
    b: Point,
    root: Bounds,
    queries: &mut Queries<'_>,
    edges: &mut Edges,
) -> io::Result<()> {
    let Bounds(w, s, e, n) = root;
    if !((a[0] == b[0] && (a[0] == w || a[0] == e)) || (a[1] == b[1] && (a[1] == s || a[1] == n))) {
        return Ok(());
    }
    let ia = queries.sample(a)? > queries.level;
    let ib = queries.sample(b)? > queries.level;
    if !ia && !ib {
        return Ok(());
    }
    let p = if ia == ib { a } else { queries.cross(a, b)? };
    edges.add(if ia { a } else { p }, if ib { b } else { p });
    Ok(())
}
pub struct BoxFan {
    pub bounds: Bounds,
    pub boundary: Vec<Point>,
}
/// Callers can supply conforming adaptive fans or regular boxes, with the same tracer.
pub fn trace_boxes(
    kernel: &dyn SpatialKernel,
    root: Bounds,
    boxes: impl IntoIterator<Item = BoxFan>,
    at: &mut dyn FnMut(Point) -> io::Result<f64>,
    options: Options,
) -> io::Result<Option<Geometry>> {
    try_trace_boxes(kernel, root, boxes.into_iter().map(Ok), at, options)
}
pub fn try_trace_boxes(
    kernel: &dyn SpatialKernel,
    root: Bounds,
    boxes: impl IntoIterator<Item = io::Result<BoxFan>>,
    at: &mut dyn FnMut(Point) -> io::Result<f64>,
    options: Options,
) -> io::Result<Option<Geometry>> {
    let Options {
        precision,
        level,
        tolerance,
    } = options;
    let mut edges = Edges::new(precision);
    let mut queries = Queries {
        at,
        level,
        tolerance: (precision / 10.0).max(tolerance / 16.0),
        stations: Cache::new(),
        crossings: Cache::new(),
    };
    let mut row = f64::NAN;
    for fan in boxes {
        let fan = fan?;
        let Bounds(w, s, e, n) = fan.bounds;
        if s != row {
            queries.stations.clear();
            queries.crossings.clear();
            row = s;
        }
        let center = [(w + e) / 2.0, (s + n) / 2.0];
        for i in 0..fan.boundary.len() {
            let a = fan.boundary[i];
            let b = fan.boundary[(i + 1) % fan.boundary.len()];
            trace([center, a, b], &mut queries, tolerance, &mut edges)?;
            outer(a, b, root, &mut queries, &mut edges)?;
        }
    }
    polygonize(edges, kernel, &mut |point| queries.sample(point), level)
}
pub fn regular(
    kernel: &dyn SpatialKernel,
    bounds: Bounds,
    dimensions: [usize; 2],
    at: &mut dyn FnMut(Point) -> io::Result<f64>,
    options: Options,
) -> io::Result<Option<Geometry>> {
    let [width, height] = dimensions;
    let Bounds(w, s, e, n) = bounds;
    let dx = (e - w) / (width - 1) as f64;
    let dy = (n - s) / (height - 1) as f64;
    let boxes = (0..height - 1).flat_map(|y| {
        (0..width - 1).map(move |x| {
            let x0 = w + x as f64 * dx;
            let y0 = s + y as f64 * dy;
            let x1 = if x == width - 2 {
                e
            } else {
                w + (x + 1) as f64 * dx
            };
            let y1 = if y == height - 2 {
                n
            } else {
                s + (y + 1) as f64 * dy
            };
            let xm = (x0 + x1) / 2.0;
            let ym = (y0 + y1) / 2.0;
            BoxFan {
                bounds: Bounds(x0, y0, x1, y1),
                boundary: vec![
                    [x0, y0],
                    [xm, y0],
                    [x1, y0],
                    [x1, ym],
                    [x1, y1],
                    [xm, y1],
                    [x0, y1],
                    [x0, ym],
                ],
            }
        })
    });
    trace_boxes(kernel, bounds, boxes, at, options)
}
