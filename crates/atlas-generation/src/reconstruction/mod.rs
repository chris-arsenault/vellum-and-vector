//! Immutable captured fields. Generation still uses the common triangular lattice.
mod adaptive;
pub mod build;
pub mod classes;
mod corner_values;
pub mod extrema;
mod fit;
pub mod grid_build;
mod hermite;
pub mod mapping;
pub mod resample;
pub mod surface;
pub mod topology;
pub mod traits;
mod tree;
pub mod vertices;
use crate::storage::{Coverage, ReadBand};
use adaptive::Adaptive;
use std::io;
use topology::Topology;
#[derive(Clone)]
pub enum Layout {
    Raster { width: usize, height: usize },
    Adaptive(Topology),
}
#[derive(Clone)]
pub struct Grid {
    pub bounds: [f64; 4],
    pub periodic_width: Option<f64>,
    pub layout: Layout,
    pub measures: ReadBand<f64>,
}
impl Grid {
    fn sample_bounds(&self) -> [f64; 4] {
        match &self.layout {
            Layout::Adaptive(topology) => topology.bounds,
            Layout::Raster { .. } => self.bounds,
        }
    }
    pub fn sample_index(&self, point: [f64; 2]) -> io::Result<usize> {
        let p = self.chart(point);
        let [west, south, east, north] = self.sample_bounds();
        let p = [p[0].clamp(west, east), p[1].clamp(south, north)];
        match &self.layout {
            Layout::Adaptive(topology) => topology
                .at(p)?
                .ok_or_else(|| io::Error::other("Captured position has no donor")),
            Layout::Raster { width, height } => Ok((((p[1] - south) / (north - south)
                * (height - 1) as f64
                + 0.5)
                .floor() as usize)
                * width
                + ((p[0] - west) / (east - west) * (width - 1) as f64 + 0.5).floor() as usize),
        }
    }
    pub fn position(&self, cell: usize) -> io::Result<[f64; 2]> {
        match &self.layout {
            Layout::Raster { width, height } => {
                let [x0, y0, x1, y1] = self.bounds;
                Ok([
                    x0 + (x1 - x0) * (cell % width) as f64 / (width - 1) as f64,
                    y0 + (y1 - y0) * (cell / width) as f64 / (height - 1) as f64,
                ])
            }
            Layout::Adaptive(t) => {
                let b = t.cell(cell)?;
                Ok([(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0])
            }
        }
    }
    pub fn chart(&self, mut point: [f64; 2]) -> [f64; 2] {
        if let Some(width) = self.periodic_width.filter(|&w| w > 0.0) {
            if point[0] < self.bounds[0] || point[0] > self.bounds[2] {
                point[0] += (((self.bounds[0] + self.bounds[2]) / 2.0 - point[0]) / width + 0.5)
                    .floor()
                    * width;
            }
        }
        point
    }
}
pub struct Interpolator<'a> {
    grid: &'a Grid,
    adaptive: Option<Adaptive<'a>>,
    discrete: bool,
}
impl<'a> Interpolator<'a> {
    pub fn new(grid: &'a Grid, discrete: bool, coverage: &mut Coverage) -> Self {
        let adaptive = match &grid.layout {
            Layout::Adaptive(t) if !discrete => Some(Adaptive::new(t, coverage)),
            _ => None,
        };
        Self {
            grid,
            adaptive,
            discrete,
        }
    }
    pub fn sample(
        &mut self,
        point: [f64; 2],
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        self.sample_mapped(self.grid.locate(point)?, read)
    }
    pub fn sample_mapped(
        &mut self,
        at: mapping::Location,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        match &self.grid.layout {
            Layout::Raster { width, .. } => {
                let mapping::Location {
                    cell: i,
                    x: tx,
                    y: ty,
                } = at;
                if self.discrete {
                    return read(i + usize::from(tx >= 0.5) + usize::from(ty >= 0.5) * width);
                }
                Ok((1.0 - ty) * ((1.0 - tx) * read(i)? + tx * read(i + 1)?)
                    + ty * ((1.0 - tx) * read(i + width)? + tx * read(i + width + 1)?))
            }
            Layout::Adaptive(_) => match &mut self.adaptive {
                Some(sampler) => Ok(sampler.patch(at.cell, read)?.sample(at.x, at.y)),
                None => read(at.cell),
            },
        }
    }
}
