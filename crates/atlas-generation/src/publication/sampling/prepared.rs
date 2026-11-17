//! Map pixel geography prepared once for every channel on the same output grid.
use super::{RasterGrid, Source};
use crate::{
    control::GenerationControl,
    reconstruction::{
        mapping::{Location, Mapping},
        Grid, Layout,
    },
    spatial::SpatialKernel,
    storage::{Band, Coverage},
};
use atlas_map::Position;
use std::{cell::RefCell, io, rc::Rc};

pub struct Prepared {
    pub grid: RasterGrid,
    covered: Band<u8>,
    mappings: Vec<(Rc<Grid>, Mapping)>,
    wrap: Option<[f64; 2]>,
}
pub struct Tile {
    pub width: usize,
    pub height: usize,
    pub points: Vec<[f64; 2]>,
    pub inside: Vec<bool>,
    indices: Vec<usize>,
}
impl Prepared {
    pub async fn new(
        source: &Source<'_>,
        grid: RasterGrid,
        storage: &RefCell<Coverage>,
        spatial: &dyn SpatialKernel,
        control: &impl GenerationControl,
    ) -> io::Result<Self> {
        let count = (grid.width as usize + 2)
            .checked_mul(grid.height as usize + 2)
            .ok_or_else(|| io::Error::other("Map halo exceeds address space"))?;
        let mut result = Self {
            grid,
            covered: storage.borrow_mut().scratch(count, 0),
            mappings: Vec::new(),
            wrap: source.wrap,
        };
        for start in (0..count).step_by(4096) {
            control
                .cooperate()
                .await
                .map_err(|e| io::Error::other(format!("{e:?}")))?;
            let points: Vec<_> = (start..(start + 4096).min(count))
                .map(|i| {
                    let [x, y] = result.point(i);
                    Position::xy(x, y)
                })
                .collect();
            for (offset, yes) in spatial
                .covers_points(source.footprint, &points)
                .map_err(io::Error::other)?
                .into_iter()
                .enumerate()
            {
                result.covered.set(start + offset, u8::from(yes))?;
            }
        }
        for field in [Some(source.field), source.water, source.ice, source.surface]
            .into_iter()
            .flatten()
        {
            result.add_grid(&field.grid, &mut storage.borrow_mut())?;
        }
        Ok(result)
    }
    fn add_grid(&mut self, grid: &Rc<Grid>, storage: &mut Coverage) -> io::Result<()> {
        // Regular-grid locations are arithmetic; retaining one per display pixel wastes
        // memory as presentation density grows. Adaptive searches still share mappings.
        if matches!(grid.layout, Layout::Raster { .. }) {
            return Ok(());
        }
        if self.mappings.iter().any(|(held, _)| Rc::ptr_eq(held, grid)) {
            return Ok(());
        }
        let mapping = Mapping::new(grid, self.covered.len(), |i| Ok(self.point(i)), storage)?;
        self.mappings.push((grid.clone(), mapping));
        Ok(())
    }
    fn point(&self, index: usize) -> [f64; 2] {
        let width = self.grid.width as usize + 2;
        let [dx, dy] = self.grid.pixel_span();
        let x = self.grid.bounds.0 + (index % width) as f64 * dx - dx / 2.0;
        [
            self.wrap.map_or(x, |[w, e]| w + (x - w).rem_euclid(e - w)),
            self.grid.bounds.3 - (index / width) as f64 * dy + dy / 2.0,
        ]
    }
    pub fn tile(&self, col: usize, row: usize, width: usize, height: usize) -> io::Result<Tile> {
        let covered = self.covered.read_only();
        let covered = covered.read_values()?;
        let indices: Vec<_> = (0..width * height)
            .map(|i| (row + i / width) * (self.grid.width as usize + 2) + col + i % width)
            .collect();
        Ok(Tile {
            width,
            height,
            points: indices.iter().map(|&i| self.point(i)).collect(),
            inside: indices
                .iter()
                .map(|&i| Ok(covered.get(i)? != 0))
                .collect::<io::Result<_>>()?,
            indices,
        })
    }
    pub fn locations(&self, grid: &Rc<Grid>, tile: &Tile) -> io::Result<Option<Vec<Location>>> {
        self.mappings
            .iter()
            .find(|(held, _)| Rc::ptr_eq(held, grid))
            .map(|(_, mapping)| mapping.select(&tile.indices))
            .transpose()
    }
}
