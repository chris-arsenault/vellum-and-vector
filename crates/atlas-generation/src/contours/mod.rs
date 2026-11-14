//! Cartographic tracing, using the same directed edges and GIS polygonization on both hosts.
mod curves;
mod edges;
mod linear;
use crate::spatial::SpatialKernel;
use atlas_map::Geometry;
pub use curves::{regular, trace_boxes, try_trace_boxes, BoxFan};
pub use edges::Edges;
pub use linear::Linear;
use std::io;
pub type Point = [f64; 2];
pub type Sample = [f64; 3];
#[derive(Clone, Copy)]
pub struct Options {
    pub precision: f64,
    pub level: f64,
    pub tolerance: f64,
}
pub fn mix(a: Point, b: Point, t: f64) -> Point {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
pub fn polygonize(
    edges: Edges,
    kernel: &dyn SpatialKernel,
    at: &mut dyn FnMut(Point) -> io::Result<f64>,
    level: f64,
) -> io::Result<Option<Geometry>> {
    let lines = edges.lines()?;
    if lines.is_empty() {
        return Ok(None);
    }
    let mut failure = None;
    let result = kernel.polygonize_area(&lines, &mut |point| {
        if failure.is_some() {
            return false;
        }
        let [x, y, _] = point.coordinates();
        match at([x, y]) {
            Ok(value) => value > level,
            Err(error) => {
                failure = Some(error);
                false
            }
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    result.map_err(io::Error::other)
}
