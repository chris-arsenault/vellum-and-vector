//! Value-independent donor addresses shared by channels on the same captured grid.
use super::{Grid, Layout};
use crate::storage::{Band, Coverage};
use std::io;

#[derive(Clone, Copy)]
pub struct Location {
    pub cell: usize,
    pub x: f64,
    pub y: f64,
}
impl Grid {
    pub fn locate_points(&self, points: &[[f64; 2]]) -> io::Result<Vec<Location>> {
        match &self.layout {
            Layout::Adaptive(tree) => {
                tree.locations(&points.iter().map(|&p| self.chart(p)).collect::<Vec<_>>())
            }
            Layout::Raster { .. } => points.iter().map(|&p| self.locate(p)).collect(),
        }
    }
    pub fn locate(&self, point: [f64; 2]) -> io::Result<Location> {
        let point = self.chart(point);
        let [w, s, e, n] = self.sample_bounds();
        let point = [point[0].clamp(w, e), point[1].clamp(s, n)];
        match &self.layout {
            Layout::Raster { width, height } => {
                let gx = (point[0] - w) / (e - w) * (width - 1) as f64;
                let gy = (point[1] - s) / (n - s) * (height - 1) as f64;
                let x = (gx.floor() as usize).min(width - 2);
                let y = (gy.floor() as usize).min(height - 2);
                Ok(Location {
                    cell: y * width + x,
                    x: gx - x as f64,
                    y: gy - y as f64,
                })
            }
            Layout::Adaptive(tree) => {
                let cell = tree
                    .at(point)?
                    .ok_or_else(|| io::Error::other("Captured position has no donor"))?;
                let b = tree.cell(cell)?;
                Ok(Location {
                    cell,
                    x: (point[0] - b[0]) / (b[2] - b[0]),
                    y: (point[1] - b[1]) / (b[3] - b[1]),
                })
            }
        }
    }
}

pub struct Mapping {
    cells: Band<u32>,
    x: Band<f64>,
    y: Band<f64>,
}
impl Mapping {
    pub fn new(
        source: &Grid,
        count: usize,
        position: impl Fn(usize) -> io::Result<[f64; 2]>,
        coverage: &mut Coverage,
    ) -> io::Result<Self> {
        let mut mapping = Self {
            cells: coverage.scratch(count, 0),
            x: coverage.scratch(count, 0.0),
            y: coverage.scratch(count, 0.0),
        };
        for start in (0..count).step_by(4096) {
            let points = (start..(start + 4096).min(count))
                .map(&position)
                .collect::<io::Result<Vec<_>>>()?;
            for (offset, at) in source.locate_points(&points)?.into_iter().enumerate() {
                let i = start + offset;
                mapping
                    .cells
                    .set(i, u32::try_from(at.cell).map_err(io::Error::other)?)?;
                mapping.x.set(i, at.x)?;
                mapping.y.set(i, at.y)?;
            }
        }
        Ok(mapping)
    }
    pub fn batch(&self, start: usize, length: usize) -> io::Result<Vec<Location>> {
        self.select(&(start..start + length).collect::<Vec<_>>())
    }
    pub fn select(&self, indices: &[usize]) -> io::Result<Vec<Location>> {
        let cells = self.cells.read_only();
        let x = self.x.read_only();
        let y = self.y.read_only();
        let cells = cells.read_values()?;
        let x = x.read_values()?;
        let y = y.read_values()?;
        indices
            .iter()
            .map(|&i| {
                Ok(Location {
                    cell: cells.get(i)? as usize,
                    x: x.get(i)?,
                    y: y.get(i)?,
                })
            })
            .collect()
    }
}
