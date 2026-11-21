//! An editable height grid for authored maps ([ADR 0019](../../../../../docs/adr/0019-authored-maps.md)).
//! Heights are metres with sea level at 0, held north-first. The grid is pure data: edits are
//! stamped by brushes and height shapes, coasts fix land against sea, and `encode` writes the
//! viewer's terrain GeoTIFF with every other band derived from the height.
mod brush;
mod coast;
mod codec;
mod geom;
mod shape;

pub use coast::{LOWLAND_M, OCEAN_FLOOR_DEPTH_M, SHORE_WIDTH_PIXELS};
pub use codec::Encoded;
pub use shape::{BrushMode, HeightArea, HeightLine, HeightPeak, Rect, Stroke};

use super::raster::RasterGrid;
use std::io;

/// Lowest and highest heights an edit can leave, in metres.
pub const MIN_HEIGHT_M: f32 = -11_000.0;
pub const MAX_HEIGHT_M: f32 = 9_000.0;

#[derive(Clone, Debug)]
pub struct Terrain {
    pub grid: RasterGrid,
    heights: Vec<f32>,
}
impl Terrain {
    /// A blank map: every cell at the deep-ocean floor.
    pub fn ocean(grid: RasterGrid) -> io::Result<Self> {
        let count = grid.count()?;
        Ok(Self {
            grid,
            heights: vec![-OCEAN_FLOOR_DEPTH_M; count],
        })
    }
    pub fn from_heights(grid: RasterGrid, heights: Vec<f32>) -> io::Result<Self> {
        if heights.len() != grid.count()? {
            return Err(io::Error::other(
                "The heights do not match the map's pixel count",
            ));
        }
        if heights.iter().any(|h| !h.is_finite()) {
            return Err(io::Error::other("Terrain heights must be finite numbers"));
        }
        Ok(Self { grid, heights })
    }
    pub fn heights(&self) -> &[f32] {
        &self.heights
    }
    pub fn full(&self) -> Rect {
        Rect {
            col0: 0,
            row0: 0,
            col1: self.grid.width,
            row1: self.grid.height,
        }
    }
    /// The pixel under a map position, or `None` outside the map.
    pub fn cell_at(&self, x: f64, y: f64) -> Option<(u32, u32)> {
        let [dx, dy] = self.grid.pixel_span();
        let col = ((x - self.grid.bounds.0) / dx).floor();
        let row = ((self.grid.bounds.3 - y) / dy).floor();
        let inside = col >= 0.0
            && row >= 0.0
            && col < f64::from(self.grid.width)
            && row < f64::from(self.grid.height);
        inside.then_some((col as u32, row as u32))
    }
    pub fn cell_centre(&self, col: u32, row: u32) -> (f64, f64) {
        geom::centre(self.grid, col, row)
    }
    /// The pixels whose centres may lie within the map-unit box, clamped to the grid.
    pub(crate) fn extent(&self, west: f64, south: f64, east: f64, north: f64) -> Rect {
        let [dx, dy] = self.grid.pixel_span();
        let across = |v: f64, limit: u32| (v.floor().max(0.0) as u64).min(u64::from(limit)) as u32;
        let (c0, c1) = (
            (west - self.grid.bounds.0) / dx,
            (east - self.grid.bounds.0) / dx,
        );
        let (r0, r1) = (
            (self.grid.bounds.3 - north) / dy,
            (self.grid.bounds.3 - south) / dy,
        );
        Rect {
            col0: across(c0, self.grid.width),
            row0: across(r0, self.grid.height),
            col1: across(c1 + 1.0, self.grid.width),
            row1: across(r1 + 1.0, self.grid.height),
        }
        .intersect(self.full())
    }
    pub(crate) fn index(&self, col: u32, row: u32) -> usize {
        row as usize * self.grid.width as usize + col as usize
    }
    pub(crate) fn set_clamped(&mut self, index: usize, height: f32) {
        self.heights[index] = height.clamp(MIN_HEIGHT_M, MAX_HEIGHT_M);
    }
    /// A copy of the heights in `rect` (clamped to the grid), row by row: an undo pre-image.
    pub fn patch(&self, rect: Rect) -> Vec<f32> {
        let rect = rect.intersect(self.full());
        let mut out = Vec::with_capacity(rect.area());
        for row in rect.row0..rect.row1 {
            let start = self.index(rect.col0, row);
            out.extend_from_slice(&self.heights[start..start + rect.width() as usize]);
        }
        out
    }
    /// Put back a `patch` of the same rectangle.
    pub fn restore(&mut self, rect: Rect, heights: &[f32]) -> io::Result<()> {
        if rect.intersect(self.full()) != rect || heights.len() != rect.area() {
            return Err(io::Error::other(
                "The saved heights do not fit the rectangle on this map",
            ));
        }
        let width = rect.width() as usize;
        for (i, row) in (rect.row0..rect.row1).enumerate() {
            let start = self.index(rect.col0, row);
            self.heights[start..start + width]
                .copy_from_slice(&heights[i * width..(i + 1) * width]);
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;
    use atlas_map::Bounds;

    /// A 40 by 30 pixel map of 10-unit pixels with its south-west corner at the origin.
    pub fn grid() -> RasterGrid {
        RasterGrid {
            width: 40,
            height: 30,
            bounds: Bounds(0.0, 0.0, 400.0, 300.0),
        }
    }
    pub fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<[f64; 2]> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }
}
#[cfg(test)]
mod tests {
    use super::{fixtures::grid, *};

    #[test]
    fn ocean_is_below_sea_level_everywhere() {
        let t = Terrain::ocean(grid()).unwrap();
        assert_eq!(t.heights().len(), 1200);
        assert!(t.heights().iter().all(|&h| h < 0.0));
    }
    #[test]
    fn cell_lookup_counts_rows_from_the_north_edge() {
        let t = Terrain::ocean(grid()).unwrap();
        assert_eq!(t.cell_at(5.0, 295.0), Some((0, 0)));
        assert_eq!(t.cell_at(399.0, 1.0), Some((39, 29)));
        assert_eq!(t.cell_at(-1.0, 10.0), None);
        assert_eq!(t.cell_at(10.0, 300.0), Some((1, 0)));
        assert_eq!(t.cell_at(10.0, 300.5), None);
        assert_eq!(t.cell_centre(1, 0), (15.0, 295.0));
    }
    #[test]
    fn bad_grids_and_lengths_are_errors() {
        let mut flat = grid();
        flat.width = 0;
        assert!(Terrain::ocean(flat).is_err());
        assert!(Terrain::from_heights(grid(), vec![0.0; 5]).is_err());
        assert!(Terrain::from_heights(grid(), vec![f32::NAN; 1200]).is_err());
    }
    #[test]
    fn patch_and_restore_round_trip() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let rect = Rect {
            col0: 3,
            row0: 2,
            col1: 9,
            row1: 6,
        };
        let before = t.patch(rect);
        assert_eq!(before.len(), 24);
        let mut changed = vec![5.0; 24];
        changed[0] = 77.0;
        t.restore(rect, &changed).unwrap();
        assert_eq!(t.heights()[2 * 40 + 3], 77.0);
        assert_eq!(t.patch(rect), changed);
        t.restore(rect, &before).unwrap();
        assert!(t.heights().iter().all(|&h| h == -OCEAN_FLOOR_DEPTH_M));
        assert!(t.restore(rect, &[1.0]).is_err());
        assert!(t
            .restore(
                Rect {
                    col0: 0,
                    row0: 0,
                    col1: 99,
                    row1: 1
                },
                &[0.0; 99]
            )
            .is_err());
    }
}
