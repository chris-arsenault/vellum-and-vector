//! Immutable captured fields. Generation still uses the common triangular lattice.
mod adaptive;
pub mod build;
pub mod classes;
mod corner_values;
mod cubic;
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
    Adaptive(Box<Topology>),
}
#[derive(Clone)]
pub struct Grid {
    pub bounds: [f64; 4],
    pub periodic_width: Option<f64>,
    pub layout: Layout,
    pub measures: ReadBand<f64>,
    /// Donors already chosen for exact query points, shared by every clone of the grid.
    pub donors: Donors,
}
/// Every categorical import of a child cell asks for the same warped donor; the warp is
/// a pure function of the point, so each point's donor is computed once.
#[derive(Clone, Default)]
pub struct Donors(
    // hpc-exempt: sparse memo of query points already resolved, not per-cell lattice state.
    std::rc::Rc<std::cell::RefCell<std::collections::HashMap<[u64; 2], usize>>>,
);
/// Categorical donors (rock kinds, cover classes) meet along irregular contacts, as real
/// contacts do, instead of along the donor grid's straight cell edges: a sample moves by a
/// deterministic warp of up to this share of the local donor spacing before the nearest
/// donor is chosen. Finer maps see the contact's finer bends.
const CONTACT_WARP: f64 = 0.4;
const CONTACT_OCTAVES: usize = 6;
/// More query points than any working lattice or published raster holds: every channel of a
/// published raster asks for the donors of the same pixels.
const REMEMBERED_DONORS: usize = 1 << 22;
impl Grid {
    /// The donor a point takes its categorical values from. Every categorical import (rock
    /// beds, their cargo, cover, people, activity) uses this one lookup, so a child cell's
    /// categorical facts always come from one donor.
    pub fn sample_index(&self, point: [f64; 2]) -> io::Result<usize> {
        let key = [point[0].to_bits(), point[1].to_bits()];
        if let Some(&donor) = self.donors.0.borrow().get(&key) {
            return Ok(donor);
        }
        let spacing = self.donor_spacing(self.nearest_index(point)?)?;
        let warp = |salt| {
            CONTACT_WARP
                * spacing
                * crate::noise::fractal_noise(point[0], point[1], salt, spacing, CONTACT_OCTAVES)
        };
        let donor = self.nearest_index([point[0] + warp(0x7c01), point[1] + warp(0x7c02)])?;
        let mut donors = self.donors.0.borrow_mut();
        // A memo that outgrows every lattice and raster starts over rather than growing on.
        if donors.len() >= REMEMBERED_DONORS {
            donors.clear();
        }
        donors.insert(key, donor);
        Ok(donor)
    }
    fn donor_spacing(&self, cell: usize) -> io::Result<f64> {
        Ok(match &self.layout {
            Layout::Raster { width, height } => {
                let [w, s, e, n] = self.bounds;
                ((e - w) / (width - 1).max(1) as f64).max((n - s) / (height - 1).max(1) as f64)
            }
            Layout::Adaptive(topology) => {
                let [w, s, e, n] = topology.cell(cell)?;
                (e - w).max(n - s)
            }
        })
    }
    /// The chart point a precomputed donor location stands for.
    pub fn located_point(&self, at: mapping::Location) -> io::Result<[f64; 2]> {
        Ok(match &self.layout {
            Layout::Raster { width, height } => {
                let [w, s, e, n] = self.bounds;
                let dx = (e - w) / (width - 1).max(1) as f64;
                let dy = (n - s) / (height - 1).max(1) as f64;
                let (ix, iy) = (at.cell % width, at.cell / width);
                [
                    w + (ix as f64 + at.x) * dx,
                    s + (iy.min(height.saturating_sub(1)) as f64 + at.y) * dy,
                ]
            }
            Layout::Adaptive(topology) => {
                let [w, s, e, n] = topology.cell(at.cell)?;
                [w + at.x * (e - w), s + at.y * (n - s)]
            }
        })
    }
    fn sample_bounds(&self) -> [f64; 4] {
        match &self.layout {
            Layout::Adaptive(topology) => topology.bounds,
            Layout::Raster { .. } => self.bounds,
        }
    }
    fn nearest_index(&self, point: [f64; 2]) -> io::Result<usize> {
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
        if self.discrete {
            return read(self.grid.sample_index(point)?);
        }
        self.sample_mapped(self.grid.locate(point)?, read)
    }
    pub fn sample_mapped(
        &mut self,
        at: mapping::Location,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        if self.discrete {
            return read(self.grid.sample_index(self.grid.located_point(at)?)?);
        }
        match &self.grid.layout {
            Layout::Raster { width, height } => {
                let mapping::Location {
                    cell: i,
                    x: tx,
                    y: ty,
                } = at;
                let cells = cubic::window(i, *width, *height);
                let mut values = [[0.0; 4]; 4];
                for (row, cells) in values.iter_mut().zip(cells) {
                    for (value, cell) in row.iter_mut().zip(cells) {
                        *value = read(cell)?;
                    }
                }
                Ok(cubic::sample(&values, tx, ty))
            }
            Layout::Adaptive(_) => match &mut self.adaptive {
                Some(sampler) => Ok(sampler.patch(at.cell, read)?.sample(at.x, at.y)),
                None => read(at.cell),
            },
        }
    }
}
